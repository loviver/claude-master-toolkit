import { spinner, boxedOutput, c, arrow } from "../../shared/terminal.js";

import { startServer } from "../../server/index.js";

export async function dashboardCommand(options: {
  port?: string;
  open?: boolean;
}): Promise<void> {
  const port = Number(options.port ?? 3200);

  const spin = spinner("Starting ctk server...");

  try {
    await startServer(port);

    spin.succeed("Server started");

    const output = [
      c.check("Server running"),
      arrow(`http://localhost:${port}`),
      c.muted("Watching ~/.claude/projects/"),
      "",
      c.muted("Press Ctrl+C to stop"),
    ];

    console.log(boxedOutput("ctk dashboard", output));

    if (options.open !== false) {
      const { default: openBrowser } = await import("open");
      await openBrowser(`http://localhost:${port}`);
    }
  } catch (err) {
    spin.fail("Failed to start server");
    throw err;
  }
}
