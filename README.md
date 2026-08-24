# pi-system-monitor

Shows CPU, memory, free disk space, and CPU temperature.

- In Pi outside Herdr, it uses Pi's shared footer.
- In Herdr, use the command below for one global metrics display. Each Pi keeps only its extension statuses in the local footer, without the default Powerline detail rows.

Requires [`iSMC`](https://github.com/dkorunic/iSMC) on `PATH`.

## Pi

Install: `pi install https://github.com/dantetekanem/pi-system-monitor.git`

Run `/reload` after installing or updating.

## Herdr

Add one command entry to `~/.config/herdr/config.toml`:

```toml
[ui]
tab_bar_position = "bottom"
tab_bar_right_separator = " │ "
tab_bar_right = [
  { type = "command", command = "node --experimental-strip-types /path/to/pi-system-monitor/herdr-status.ts", interval_seconds = 30, timeout_seconds = 3 },
]
```

Then run `herdr server reload-config`. Herdr runs the system monitor once per server, independently of the number of Pi panes. Other Pi footer statuses remain local and under their original extensions and configuration.
