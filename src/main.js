import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./style.css";
import { bindSettings, setupDrops, renderAll } from "./ui.js";
import { restoreSaved } from "./storage.js";

bindSettings();
setupDrops();
renderAll();
restoreSaved();
