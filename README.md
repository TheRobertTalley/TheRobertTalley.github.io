# Smart Calendar Display

This repository hosts public GitHub Pages projects for `theroberttalley.github.io`.

The smart calendar display is a static webpage built for a TV or Fire Stick browser:

- Live display: https://theroberttalley.github.io/calendar/
- Short Fire Stick link: https://theroberttalley.github.io/r/
- Public source: https://github.com/TheRobertTalley/TheRobertTalley.github.io

## Fire Stick Setup

1. Open Amazon Silk on the Fire Stick.
2. Browse to `https://theroberttalley.github.io/r/`.
3. Click or tap the page once to request fullscreen.
4. Hide the Silk navigation bar from the Silk toolbar if it is visible.
5. Keep the Fire TV sleep timer and screensaver disabled for this display device.

The page refreshes weather and calendar data automatically. It also reloads itself every hour so the browser does not need a manual refresh.

## Make Your Own Copy

1. Create a GitHub account.
2. Create a repository named `YOURUSERNAME.github.io`.
3. Clone this repository or copy the `calendar/`, `scripts/`, and `.github/workflows/update-calendar.yml` files into your repository.
4. Edit `calendar/dashboard.config.js` for your display name, weather location, and calendar settings.
5. If using a different public Google Calendar, edit `scripts/build-calendar.js` or set the `CALENDAR_ICS_URL` secret or variable in GitHub Actions.
6. In GitHub, open `Settings > Pages` and publish from the main branch.
7. Visit `https://YOURUSERNAME.github.io/calendar/`.

Only people with write access to the GitHub repository can change what gets published. The webpage itself is public, but visitors cannot edit the source or calendar data unless they also have repository permissions.

## Buy Me a Root Beer

BTC: `bc1q3anz5e7uflnwte4nr5ku836h98dgunwysz203j`
