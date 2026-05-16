# Dev Server & Preview Workflow

## Starting the Server

Before starting the server, check if port 8080 is already in use:

```bash
lsof -ti :8080
```

- **Port in use** → a server is already running. Launch the preview directly at `http://localhost:8080/dashboard` without starting a new one.
- **Port free** → start the server with `bash start.sh` (or `python3 -m http.server 8080` from the project root).

If you need to restart the server, kill the existing process first:

```bash
kill $(lsof -ti :8080) && bash start.sh
```

## Testing Changes in the Preview

1. **Before testing any change**, reload the preview to ensure you're not looking at a stale page:
   ```js
   // preview_eval
   window.location.reload()
   ```

2. **After editing a stylesheet (CSS)**, always force-reload the preview to bypass browser caching — a normal reload is not enough:
   ```js
   // preview_eval — hard reload to bust CSS cache
   window.location.reload(true)
   ```
   Then wait for the page to settle before taking a screenshot or inspecting styles.

3. Use `preview_snapshot` or `preview_screenshot` to confirm the change looks correct before reporting back to the user.
