import { singleAppPolicy } from "./app-policy.js";
import { acquireInstanceLock } from "../instance-lock.js";
import { startApp } from "../start-app.jsx";
import { App } from "./App.component.jsx";

const releaseInstanceLock = await acquireInstanceLock();
if (!releaseInstanceLock) {
  console.error("Another xarab-one instance is already running.");
  process.exitCode = 1;
} else {
  try {
    await startApp({ appPolicy: singleAppPolicy, App, releaseInstanceLock });
  } catch (error) {
    await releaseInstanceLock();
    throw error;
  }
}
