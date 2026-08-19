import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
mermaid.initialize({
  startOnLoad: true,
  theme: dark ? "dark" : "neutral",
  themeVariables: dark
    ? { primaryColor: "#103038", primaryBorderColor: "#38BDD8", lineColor: "#8AA0A9" }
    : { primaryColor: "#E4F1F5", primaryBorderColor: "#0E7490", lineColor: "#5A6E77" },
  fontFamily: '"IBM Plex Sans JP", sans-serif',
});
