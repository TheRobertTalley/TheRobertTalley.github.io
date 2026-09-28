window.TalleyDashboardConfig = {
  locationLabel: "HCSO Training Center",
  clock: {
    hour12: false
  },
  weather: {
    locationName: "Gainesville, Hall County, GA",
    latitude: 34.29788,
    longitude: -83.82407,
    timezone: "America/New_York",
    temperatureUnit: "fahrenheit",
    windSpeedUnit: "mph"
  },
  refreshMinutes: 15,
  pageReloadHour: 5,
  pageReloadMinute: 0,
  calendar: {
    title: "HCSO Training Center",
    dataUrl: "./calendar-events.json?calendar=fire-tv",
    maxEvents: 6,
    visibleWeeks: 3
  },
  screen: {
    enableFullscreen: true,
    enableWakeLock: true,
    enablePixelShift: true,
    dimNightMode: true,
    dimStartHour: 22,
    dimEndHour: 6
  }
};
