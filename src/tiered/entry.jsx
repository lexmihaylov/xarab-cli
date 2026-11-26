import { tieredAppPolicy } from "./utils/app-policy.js";
import { startApp } from "../start-app.jsx";
import { App } from "./components/App.component.jsx";

await startApp({ appPolicy: tieredAppPolicy, App });
