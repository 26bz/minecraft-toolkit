import { createPlayerApp } from "../index.js";
import { serve } from "h3";

const { app } = createPlayerApp();

serve(app);
console.log("minecraft-toolkit H3 server listening on http://localhost:3000");
