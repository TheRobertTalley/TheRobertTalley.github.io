#define _GNU_SOURCE

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define LISTEN_PORT 5601
#define VIDEO_PORT 5600
#define MAX_PACKET_SIZE 65535
#define SOCKET_BUFFER_SIZE (4 * 1024 * 1024)
#ifndef SERIAL_DEVICE
#define SERIAL_DEVICE "/dev/ttyGS0"
#endif
#define SERIAL_RETRY_SECONDS 1
#define SERIAL_WRITE_TIMEOUT_MS 5
#define SLIP_END 0xC0
#define SLIP_ESC 0xDB
#define SLIP_ESC_END 0xDC
#define SLIP_ESC_ESC 0xDD
#define MAX_SLIP_FRAME_SIZE ((MAX_PACKET_SIZE * 2) + 2)

static volatile sig_atomic_t running = 1;

static void stop_relay(int signal_number)
{
    (void) signal_number;
    running = 0;
}

static void make_local_destination(struct sockaddr_in *destination)
{
    memset(destination, 0, sizeof(*destination));
    destination->sin_family = AF_INET;
    destination->sin_port = htons(VIDEO_PORT);
    destination->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
}

static int64_t monotonic_seconds(void)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        return 0;
    }
    return now.tv_sec;
}

static int open_serial_bridge(void)
{
    int descriptor = open(
        SERIAL_DEVICE,
        O_WRONLY | O_NOCTTY | O_NONBLOCK | O_CLOEXEC
    );
    if (descriptor < 0) {
        return -1;
    }

    struct termios settings;
    if (tcgetattr(descriptor, &settings) == 0) {
        cfmakeraw(&settings);
        tcsetattr(descriptor, TCSANOW, &settings);
    }
    return descriptor;
}

static size_t encode_slip(
    const uint8_t *packet,
    size_t packet_size,
    uint8_t *frame
)
{
    size_t output = 0;
    frame[output++] = SLIP_END;
    for (size_t index = 0; index < packet_size; index++) {
        if (packet[index] == SLIP_END) {
            frame[output++] = SLIP_ESC;
            frame[output++] = SLIP_ESC_END;
        } else if (packet[index] == SLIP_ESC) {
            frame[output++] = SLIP_ESC;
            frame[output++] = SLIP_ESC_ESC;
        } else {
            frame[output++] = packet[index];
        }
    }
    frame[output++] = SLIP_END;
    return output;
}

static int write_serial_frame(
    int descriptor,
    const uint8_t *frame,
    size_t frame_size
)
{
    size_t written = 0;
    while (written < frame_size) {
        ssize_t result = write(
            descriptor,
            frame + written,
            frame_size - written
        );
        if (result > 0) {
            written += (size_t) result;
            continue;
        }
        if (result < 0 && errno == EINTR) {
            continue;
        }
        if (result < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct pollfd output = {
                .fd = descriptor,
                .events = POLLOUT,
                .revents = 0,
            };
            if (poll(&output, 1, SERIAL_WRITE_TIMEOUT_MS) > 0 &&
                (output.revents & POLLOUT) != 0) {
                continue;
            }
        }
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    (void) argc;
    (void) argv;
    int receiver = -1;
    int sender = -1;
    int serial = -1;
    int64_t next_serial_retry = 0;
    uint8_t *packet = NULL;
    uint8_t *serial_frame = NULL;
    struct sockaddr_in listen_address;
    struct sockaddr_in local_destination;

    make_local_destination(&local_destination);

    signal(SIGINT, stop_relay);
    signal(SIGTERM, stop_relay);

    receiver = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    sender = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (receiver < 0 || sender < 0) {
        perror("socket");
        goto fail;
    }

    int enabled = 1;
    int buffer_size = SOCKET_BUFFER_SIZE;
    struct timeval receive_timeout = {
        .tv_sec = 0,
        .tv_usec = 250000,
    };
    setsockopt(receiver, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    setsockopt(receiver, SOL_SOCKET, SO_RCVBUF, &buffer_size, sizeof(buffer_size));
    setsockopt(
        receiver,
        SOL_SOCKET,
        SO_RCVTIMEO,
        &receive_timeout,
        sizeof(receive_timeout)
    );
    setsockopt(sender, SOL_SOCKET, SO_SNDBUF, &buffer_size, sizeof(buffer_size));

    memset(&listen_address, 0, sizeof(listen_address));
    listen_address.sin_family = AF_INET;
    listen_address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    listen_address.sin_port = htons(LISTEN_PORT);

    if (bind(receiver, (struct sockaddr *) &listen_address, sizeof(listen_address)) != 0) {
        perror("bind");
        goto fail;
    }

    packet = malloc(MAX_PACKET_SIZE);
    serial_frame = malloc(MAX_SLIP_FRAME_SIZE);
    if (!packet || !serial_frame) {
        perror("malloc");
        goto fail;
    }

    fprintf(
        stderr,
        "Sphere Quest relay: 127.0.0.1:%d -> 127.0.0.1:%d + %s\n",
        LISTEN_PORT,
        VIDEO_PORT,
        SERIAL_DEVICE
    );

    while (running) {
        ssize_t packet_size = recv(receiver, packet, MAX_PACKET_SIZE, 0);
        if (packet_size < 0) {
            if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
                continue;
            }
            perror("recv");
            goto fail;
        }

        if (sendto(
                sender,
                packet,
                (size_t) packet_size,
                MSG_DONTWAIT,
                (struct sockaddr *) &local_destination,
                sizeof(local_destination)
            ) < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
            perror("sendto local");
        }

        int64_t now = monotonic_seconds();
        if (serial < 0 && now >= next_serial_retry) {
            serial = open_serial_bridge();
            next_serial_retry = now + SERIAL_RETRY_SECONDS;
        }
        if (serial >= 0) {
            size_t frame_size = encode_slip(
                packet,
                (size_t) packet_size,
                serial_frame
            );
            if (write_serial_frame(serial, serial_frame, frame_size) != 0) {
                close(serial);
                serial = -1;
                next_serial_retry = now + SERIAL_RETRY_SECONDS;
            }
        }
    }

    if (serial >= 0) {
        close(serial);
    }
    free(serial_frame);
    free(packet);
    close(sender);
    close(receiver);
    return EXIT_SUCCESS;

fail:
    if (serial >= 0) {
        close(serial);
    }
    free(serial_frame);
    free(packet);
    if (sender >= 0) {
        close(sender);
    }
    if (receiver >= 0) {
        close(receiver);
    }
    return EXIT_FAILURE;
}
