# v3 render decals (render agent)

Generated 2026-09-27 with the `gpt-image-mchat` skill: model **gpt-image-2** through the local mchat gateway,
`background: transparent` (which forces quality medium). Transparent margins were trimmed, then the images were resized
with Lanczos and saved as webp (quality 85). Outputs are not reproducible, so a rerun gives different images.

The renderer draws these into the label atlas at runtime (`src/render/labels.js`, `upgradeLabels`). Standees are
alpha-tested cutouts. The graffiti is blended over the wallpaper by alpha.

| file | returned size | size here | prompt |
|---|---|---|---|
| `standee_chill_guy.webp` | 1024x1536 | 195x512 | Full-body cartoon illustration for a life-size cardboard standee: a relaxed anthropomorphic brown and cream cartoon dog standing upright, wearing a loose grey sweater, rolled-up blue jeans and red sneakers, hands in pockets, eyes half closed with a small smug content smile, very chill. Flat clean vector cartoon style with bold outlines, front view, whole figure visible head to toe, centered, tall portrait. Transparent background, no text, no shadow, no ground. |
| `standee_chungus.webp` | 1024x1536 | 333x512 | Full-body cartoon illustration for a cardboard standee: an extremely chubby round grey bunny with long upright ears, tiny arms, a huge round belly, bored half-closed eyes, standing upright facing forward. Flat clean vector cartoon style with bold outlines, whole figure head to toe, centered. Transparent background, no text, no shadow, no ground. |
| `graffiti_trollface.webp` | 1536x1024 | 420x320 | Black spray-paint graffiti on a wall of the classic internet trollface meme: a wide mischievous grinning face with squinting eyes and a huge toothy grin, drawn as bold rough black spray paint line art with slight drips and overspray. Only the black paint strokes, transparent background, no wall, no text. |

## Not generated

The green-ogre standee (the `shrek` kind) was rejected by the image safety system at the output stage
(`moderation_blocked`). The `shrek` meme prop is drawn procedurally instead, as a hand-lettered "GET OUT OF MY SWAMP"
cardboard sign with an onion, so no character likeness is involved.
