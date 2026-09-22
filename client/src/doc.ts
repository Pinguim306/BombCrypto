/**
 * Entry for the static doc pages (guide.html, whitepaper.html): they have no
 * page logic of their own, so this only mounts the shared site chrome
 * (header, $BLAST strip, footer) from src/site/chrome.ts.
 */
import { mountChrome } from "./site/chrome";

mountChrome({ page: "doc" });
