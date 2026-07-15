# Grainfall

A browser falling-sand sandbox. Paint powders, fluids, fire, creatures, and oddities onto a particle grid — then watch gravity, reactions, wind, and electricity play out.

**Play now:** [grainfall.vercel.app](https://grainfall.vercel.app/)

**Open source** under the [MIT License](LICENSE) — contributions are welcome. Fork it, open issues, send pull requests.

Inspired by the falling-sand toys that flooded the early 2000s web. Original mechanics throughout.

Runs fully offline. No build step, no bundler, no server required.

## Play

Open [grainfall.vercel.app](https://grainfall.vercel.app/), open `index.html` in a browser, or serve locally:

```bash
npm start
# → http://localhost:4173
```

### Controls

| Action | How |
|--------|-----|
| Paint | Click / drag on the canvas |
| Erase | **Right-click / right-drag**, or select **Erase** and paint |
| Straight line | Hold **Shift** while dragging |
| Pick material (eyedropper) | **Alt+click** a pixel to adopt its material |
| Brush size | Sidebar slider, scroll wheel over the canvas, or `[` / `]` |
| Simulation speed | Sidebar **Speed** slider |
| Material | Click the palette, keys `1`–`9` for the first nine, or `←` / `→` to cycle all |
| Tools | Free, Line, Box, Circle, Fill — or keys `F` / `L` / `B` / `O` / `G` |
| Pause | **Pause** button or `Space` |
| Clear | **Clear** button or `C` |
| Save PNG | **Save PNG** button or `S` |

### Materials

| | |
|---|---|
| **Powders** | Sand, gunpowder, snow, seed, virus |
| **Liquids** | Water, oil, lava, napalm, acid, mercury, nitro |
| **Solids** | Wall, stone, plant, ice, wood, glass, clone, torch, fan, metal |
| **Gases** | Fire, steam, gas |
| **Creatures** | Ant, bird, fighter |
| **Special** | Lightning · Erase |

### What happens when…

- **Fire & lava** burn fuels — napalm runs hottest, wood lasts longest
- **Gunpowder & nitro** detonate on contact, with chain explosions and shockwaves
- **Water** extinguishes fire and cools lava into stone (with steam)
- **Lava** melts sand into glass, and ice/snow into water
- **Acid** dissolves almost everything except wall and glass
- **Ice** slowly freezes neighboring water
- **Seeds** sprout into plants on water
- **Clone** copies whatever first touches it
- **Torch** is an eternal fire source
- **Virus** infects what it touches; fire cures it
- **Fans** blow wind in the direction you drag the stroke
- **Ants** tunnel through soft materials; **birds** fly; **fighters** patrol and lob fire
- **Metal / water / mercury** conduct electricity; **lightning** falls as a bolt — fuses sand into glass (fulgurites), cracks ice and glass, charges conductors, and ignites fuels

## Develop

```bash
npm test              # unit sim + script-load checks
npm run test:browser  # Playwright headless (needs `npx playwright install chromium`)
```

| Path | Role |
|------|------|
| `js/materials.js` | Material IDs, colors, palette, type flags |
| `js/sim.js` | Simulation core (no DOM) |
| `js/app.js` | UI, input, render loop |
| `css/style.css` | Layout and chrome |

## Contribute

Grainfall is open source and built for tinkering. Ideas for materials, reactions, tools, UI polish, bug fixes, and performance are all fair game.

1. Fork [PeytonNowlin/grainfall](https://github.com/PeytonNowlin/grainfall)
2. Create a branch for your change
3. Run `npm test` (and `npm run test:browser` if you touch the UI)
4. Open a pull request describing what you changed and why

New materials usually start in `js/materials.js` (id, color, palette entry, type flags), then get behavior in `js/sim.js`. UI wiring lives in `js/app.js`.

Questions or ideas without a patch yet? [Open an issue](https://github.com/PeytonNowlin/grainfall/issues).

## License

[MIT](LICENSE) — free to use, modify, and share. Inspired by the early-2000s falling-sand genre.
