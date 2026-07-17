# pi-system-monitor

A small macOS Pi extension that shows CPU, memory, free disk space, and optional temperature in a compact footer. The footer includes statuses published by other extensions and refreshes system metrics every five seconds.

Temperature is shown when `macmon` or `osx-cpu-temp` is already available. If neither is installed, the other metrics continue normally.

## Install

```bash
pi install https://github.com/dantetekanem/pi-system-monitor.git
```

Restart Pi after installation.
