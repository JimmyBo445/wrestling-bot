# Fonts

Railway's default Node container usually has no system fonts installed, which
means `@napi-rs/canvas` can silently render blank text on the match/profile
cards. Fix this by dropping a font file here before deploying:

1. Download a font (Inter is a good free pick): https://fonts.google.com/specimen/Inter
2. Rename the bold weight file to exactly `Inter-Bold.ttf`
3. Place it in this folder: `assets/fonts/Inter-Bold.ttf`
4. Commit it — the renderer auto-detects and registers it at boot.

If you skip this, test `/character profile` and `/match log-singles` right
after your first deploy. If the cards render with visible text, your
container already has usable system fonts and you don't need to do anything.
