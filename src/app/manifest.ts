import type { MetadataRoute } from "next";

/* Next 16 metadata route — serves /manifest.webmanifest.
 *
 * Background and theme are space black (#050608) so the splash and the status
 * bar are the bridge, not a white flash.
 *
 * Each icon entry points at its OWN file at its real pixel size. Declaring one
 * 512px file as both 192x192 and 512x512 would be a manifest that lies, and
 * browsers choose by the declared size — tests/manifest.test.ts reads the PNG
 * headers off disk rather than taking these numbers on trust. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tarik OS",
    short_name: "Tarik OS",
    description: "A personal AI operating system you talk to.",
    start_url: "/",
    display: "standalone",
    background_color: "#050608",
    theme_color: "#050608",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
