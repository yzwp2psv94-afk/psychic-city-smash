# Psychic City Smash · v2.0 (3D)

Prototipo jugable de destrucción urbana con poderes psíquicos, inspirado en *City Smash 2* y con autos al estilo *Wreckfest* (daño progresivo, chatarra y manejo arcade-sim). Desde la v2.0 se renderiza en **3D con Three.js** (r169, vía import map desde CDN). Todas las texturas son procedurales (canvas) y no se descargan assets.

## Cómo abrir

```bash
cd psychic-city-smash
python3 -m http.server 8080
```

Luego visita `http://localhost:8080`.

- No hay paso de build: HTML + CSS + módulos ES. Three.js se carga desde `cdn.jsdelivr.net`, así que **se necesita internet** la primera vez (después queda en la caché del navegador).
- Abrir con `file://` no se recomienda porque Chrome bloquea los módulos ES locales.
- La versión 2D original está respaldada en `../psychic-city-smash.bak-2d/`.

## Controles (teclado + mouse)

| Acción | Input |
|--------|-------|
| Mover avatar (relativo a la cámara) | **WASD** / flechas |
| Apuntar | Mouse (la mira sigue el suelo o la fachada bajo el cursor) |
| Usar poder | **Clic izq.**: mantener para **cargar** y soltar para lanzar o disparar |
| Elegir poder | **1–5** o barra inferior |
| **Fuerza psíquica** | **Rueda del mouse**, **[ / ]** o **− / +**, o el slider *Fuerza* (abajo a la derecha) |
| **Atrapar / congelar** objetos en vuelo | **Q** o **clic der.** (mantener) |
| **Redirigir** lo congelado | **F**: mantener para cargar y soltar para lanzar hacia la mira |
| Girar cámara | **Z / X** o arrastrar con **clic central** |
| Zoom | **Ctrl/Alt + rueda** |
| Entrar / salir de auto | **E** (aparece el aviso «E · Entrar» sobre el auto cercano) |
| Acelerar / frenar / reversa | **W/S** al conducir |
| Girar | **A/D** al conducir |
| Freno de mano / drift | **Shift** |
| Enderezar auto / centrar cámara | **R** |
| Pausar | **Espacio** / **Esc** / botón Pausa |

### Carga y fuerza

- **Carga** (~1.1 s para llegar al máximo): el medidor sobre la barra de poderes muestra el % de carga, la fuerza y la velocidad estimada del lanzamiento.
- **Fuerza** (5–100 %): escala todo, desde un **empujón suave** hasta un **lanzamiento enorme**. La velocidad de lanzamiento va de unos 9 km/h (fuerza mínima, sin carga) a más de 500 km/h (fuerza y carga máximas).
- **TK**: haz clic sobre un escombro, una pieza de auto o **cualquier auto** (intacto o chatarra) para agarrarlo; flota entre tú y la mira. Suelta para lanzarlo en arco hacia la mira. El daño es proporcional a **masa × velocidad**: un auto (masa 10) pega mucho más fuerte que un ladrillo.
- **Onda de choque / Aplastar / Slam**: mantener para cargar; el radio y el daño escalan con carga × fuerza.
- **Atrapar**: mientras mantienes Q, todo lo que vuela cerca de la mira o de ti (incluidos los proyectiles del rival) se **congela en el aire** durante ~5 s. Con **F** los rediriges todos juntos hacia la mira.

## iPhone 14 y Control Bluetooth

En el menú principal:

1. **Móvil · iPhone 14**: HUD táctil. En un iPhone/iPad/Android real se activa **solo** (cualquier orientación, pantalla completa); en la compu es una vista previa de 390×844.
   - **Joystick** izquierdo: mover o conducir.
   - **Tocar / mantener en el mapa 3D** = igual que el mouse: mantener = agarrar y cargar, arrastrar = apuntar, soltar = lanzar.
   - **2 dedos**: pellizcar = zoom de la cámara (no de la página), deslizar = girar cámara. Botones **− / +** (zoom) y **↺ / ↻** (girar).
   - **⚡ Poder**: mantener = agarrar/cargar, arrastrar el dedo = mover la mira, soltar = lanzar.
   - **💥 Slam** rápido, **🚗 Entrar**, **🧊 Atrapar**, **↗ Redirigir**, **🛑 Freno**, **⟲** (enderezar/cámara). Pausa arriba a la derecha.
   - Slider **Fuerza** sobre el joystick y barra de poderes 1–5 abajo (tocar = elegir).
   - En escritorio: **Ctrl + rueda** = zoom (rueda sola = fuerza).
2. **Control Bluetooth**: Gamepad API (se puede combinar con el layout iPhone).

| Gamepad | Acción |
|---------|--------|
| Stick izq. | Mover / acelerar-girar |
| Stick der. | Mover la mira (a pie) / mirar alrededor (auto) |
| **RT** (analógico) | Mantener = cargar poder; la profundidad del gatillo controla qué tan rápido carga. Soltar = lanzar |
| **LT** | A pie: **atrapar/congelar** · en auto: freno de mano |
| **B** | A pie: **redirigir** (mantener/soltar) · en auto: freno de mano |
| A | Entrar / salir del auto |
| X / Y | Poder anterior / siguiente |
| D-pad ↑/↓ | **Fuerza ±10 %** mientras cargas o sostienes algo; si no, poderes 1/2 |
| D-pad ←/→ | Poderes 3 / 4 |
| L3 | Ciclar presets de fuerza (10/35/60/100 %) |
| R3 | Enderezar auto / centrar cámara |
| LB | Disparo rápido |
| RB | Escudo (poder 5) |
| Start / Select | Pausa |

## Cámaras y render

- **A pie**: cámara elevada en ángulo, que se gira con Z/X, arrastre o el stick derecho.
- **Conduciendo**: cámara de persecución en tercera persona con retraso, y FOV que se abre con la velocidad. HUD de daño estilo Wreckfest más velocímetro.
- Iluminación: sombras PCF suaves que siguen al jugador, cielo con degradado, niebla e iluminación hemisférica. Explosiones con luces puntuales.
- Ciudad:
  - Calles texturizadas con líneas de carril, cruces peatonales, banquetas y alcantarillas.
  - Edificios por pisos con ventanas emisivas (InstancedMesh).
  - Los pisos colapsan en trozos que dejan pilas de escombro persistentes.
  - Grietas y cráteres en el asfalto.
- Partículas (polvo, humo, fuego, chispas, vidrio, energía psíquica) en dos capas de `Points` con shader propio y tope de 1800.
- Autos low-poly hechos con primitivas: abolladuras por vértice en el punto de impacto, vidrios que se agrietan y rompen, pintura chamuscada y piezas que se desprenden (capó, puertas, defensa, ruedas).

## Poderes psíquicos

1. **Telequinesis (TK)**: agarra escombros, piezas de auto o autos completos y lánzalos con carga.
2. **Onda de choque**: empuje radial cargable en la mira.
3. **Aplastar**: daño enfocado en un segmento de edificio o en un auto.
4. **Levitación / Slam**: levanta y estrella contra el suelo.
5. **Escudo**: escudo breve que reduce el daño.

La energía se regenera sola. Al conducir, los poderes cuestan ~60 % más.

## Modos

- **Sandbox libre**: destruye sin límite.
- **Tiempo límite**: 2 minutos.
- **Pelea psíquica**: rival IA que también lanza escombros (puedes atraparlos y devolvérselos).
- **Supervivencia**: oleadas de NPCs y autos hostiles.

## Mecánicas clave

- **Destrucción persistente** durante la sesión. *Nueva sesión* reinicia todo: puntuación 0 y destrucción 0 %.
- **Puntuación solo por el jugador**: solo cuentan los daños que tú causas (al conducir, con TK, con poderes o con objetos que lanzaste). El tráfico IA sigue carriles, respeta los cruces (un auto a la vez) y nunca choca solo.
- **Autos estilo Wreckfest**: vida multiparte, 4 niveles visuales, piezas desprendibles reutilizables con TK, explosiones e incendios al quedar como chatarra.
- **NPCs** que huyen del caos (tono arcade, sin gore).

## Estructura

```
psychic-city-smash/
  index.html        — import map (three), HUD, menú
  css/style.css
  js/game.js        — bucle, input, sesión, cámara, puntuación
  js/renderer3d.js  — escena Three.js (ciudad, autos, partículas, mira, cámaras)
  js/carmodel.js    — modelo low-poly deformable de los autos
  js/textures.js    — texturas procedurales (calles, fachadas, grietas…)
  js/world.js       — mapa, edificios por pisos, props, escombro, explosiones
  js/physics.js     — cuerpos, partículas
  js/vehicles.js    — manejo, IA de carriles, daño progresivo, colisiones
  js/powers.js      — poderes, carga, fuerza, atrapar/redirigir
  js/npcs.js        — civiles, rival, oleadas
  js/ui.js          — menú / HUD
  js/mobile.js      — táctil iPhone 14 + Gamepad
  js/audio.js       — efectos Web Audio
  screens/          — capturas headless
```

## Créditos / aviso

Prototipo fan / sandbox educativo. No afiliado a City Smash ni Wreckfest.
