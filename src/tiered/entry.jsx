import { tieredAppPolicy } from "./app-policy.js";
import { startApp } from "../start-app.jsx";
import { App } from "./App.component.jsx";

await startApp({ appPolicy: tieredAppPolicy, App });
