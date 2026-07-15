# Grainfall

A browser falling-sand sandbox. Paint powders, fluids, fire, creatures, and oddities onto a particle grid — then watch gravity, reactions, wind, and electricity play out.

**Play now:** [grainfall.vercel.app](https://grainfall.vercel.app/)

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
| Straight line | Hold **Shift** while dragging |
| Brush size | Sidebar slider, or scroll wheel over the canvas |
| Simulation speed | Sidebar **Speed** slider |
| Material | Click the palette, or keys `1`–`9` for the first nine |
| Tools | Free, Line, Box, Circle, Fill |
| Erase | Select **Erase**, then paint |
| Pause | **Pause** button or `Space` |
| Clear | **Clear** button or `C` |

### Materials

| | |
|---|---|
| **Powders** | Sand, gunpowder, snow, seed, virus |
| **Liquids** | Water, oil, lava, napalm, acid, mercury, nitro |
| **Solids** | Wall, stone, plant, ice, wood, glass, clone, torch, fan, metal |
| **Gases** | Fire, steam, gas |
| **Creatures** | Ant, bird, fighter |
| **Special** | Thunder · Erase |

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
- **Metal** conducts electricity; **thunder** sparks the grid

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

## License

Personal / hobby project. Inspired by the early-2000s falling-sand genre.
