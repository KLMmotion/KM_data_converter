const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function resolveElectronPath() {
  const candidates = [
    path.join(__dirname, "..", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron"),
    path.join(__dirname, "..", "..", "km_data_converter_UI", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    return require("electron");
  } catch (error) {
    throw new Error(
      "Electron is not installed correctly. Run `npm.cmd install` in km_data_check_UI, or reinstall Electron with `npm.cmd install electron@^31.7.7 --save-dev`."
    );
  }
}

const electron = resolveElectronPath();

const child = spawn(electron, ["."], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
