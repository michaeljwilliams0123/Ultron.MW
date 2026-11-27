// Source-tree entry point; the package builder copies the canonical module
// here instead so that the installed extension never imports outside its root.
export {createNativeBrowserClient} from '../../src/computer/native-browser-client.mjs';
