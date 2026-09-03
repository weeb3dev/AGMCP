import "./style.css";
import { mountUi, handleZipSubmit, renderWebMcpBanner } from "./ui";
import { registerWebMcpTools, wireDeclarativeForm } from "./webmcp";
import { setLocation } from "./app";
import { state } from "./store";

mountUi();

const form = document.getElementById("zip-form") as HTMLFormElement;
wireDeclarativeForm(form, handleZipSubmit);
// Chrome fires these when an agent fills the declarative form tool.
window.addEventListener("toolactivated", () => form.classList.add("tool-active"));
window.addEventListener("toolcancel", () => form.classList.remove("tool-active"));
form.addEventListener("submit", () => form.classList.remove("tool-active"));

// Deep link: /?zip=97330
const zipParam = new URLSearchParams(location.search).get("zip");
if (zipParam) {
  try {
    setLocation(zipParam);
  } catch {
    /* ignore bad deep links */
  }
}
if (state.zip) (document.getElementById("zip-input") as HTMLInputElement).value = state.zip;

registerWebMcpTools().then(renderWebMcpBanner);
