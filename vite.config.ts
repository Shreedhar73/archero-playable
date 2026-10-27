import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One build per ad network, picked with `--mode <network>`. The list adapts to
// which adapter files exist, so the generator can delete unused adapters
// without touching this file. Plain `vite` previews the first network.
const root = fileURLToPath(new URL(".", import.meta.url));
const NETWORKS = ["generic", "meta", "google", "applovin"].filter((n) =>
  existsSync(resolve(root, `src/adapters/${n}.ts`)),
);

/** Per-network tags in <head>, added after Vite's HTML pass so it leaves them alone. */
function networkHead(network: string): Plugin {
  const tags: Record<string, HtmlTagDescriptor[]> = {
    // Google App campaigns: orientation meta plus the literal exitapi.js tag,
    // the one external reference the spec allows (ExitApi.exit() is the CTA).
    google: [
      {
        tag: "meta",
        attrs: { name: "ad.orientation", content: "portrait" },
        injectTo: "head",
      },
      {
        tag: "script",
        attrs: {
          type: "text/javascript",
          src: "https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js",
        },
        injectTo: "head",
      },
    ],
  };
  return {
    name: "playable-network-head",
    transformIndexHtml: () => tags[network] ?? [],
  };
}

export default defineConfig(({ mode }) => {
  const network = NETWORKS.includes(mode) ? mode : NETWORKS[0];
  return {
    base: "./",
    // Vite's default asset list has no .glb , so without this the import is a modules resolution error at build time
    assetsInclude: ["**/*.glb"],
    // Every script, font, image and sound is inlined: ad networks forbid
    // runtime requests.
    plugins: [networkHead(network), viteSingleFile()],
    resolve: {
      alias: [
        // Only the chosen network's adapter enters the bundle — Meta's scanner
        // must never see another network's CTA code.
        {
          find: /^@network$/,
          replacement: resolve(root, `src/adapters/${network}.ts`),
        },
      ],
    },
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
    },
    // No modulepreload polyfill: everything is inline, and its fetch() is one
    // more request-shaped string for a network's scanner to flag.
    build: {
      target: "es2020",
      outDir: `dist/${network}`,
      emptyOutDir: true,
      assetsInlineLimit: Infinity,
      modulePreload: { polyfill: false },
    },
    define: {
      APP_VERSION: JSON.stringify(process.env.npm_package_version),
    },
  };
});
