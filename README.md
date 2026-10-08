# Psychic City Smash · v4.1 (3D)

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
| **Atrapar / congelar** objetos en vuelo | **Q** (mantener) |
| **Redirigir** lo congelado | **G**: mantener para cargar y soltar para lanzar hacia la mira |
| **Cámara**: 1.ª persona → 3.ª persona cerca → 3.ª persona lejana | **V** (clic = capturar el mouse para mirar; Esc lo suelta) |
| **Volar** (activar/desactivar) | **F** · subir **Espacio** · bajar **C** / **Shift** |
| **Láser de los ojos** | **L** o **clic der.** (mantener) |
| Girar cámara | Mouse (capturado), **Z / X** o arrastrar con **clic central** |
| Zoom | **Ctrl/Alt + rueda** |
| Entrar / salir de auto | **E** (aparece el aviso «E · Entrar» sobre el auto cercano) |
| Acelerar / frenar / reversa | **W/S** al conducir |
| Girar | **A/D** al conducir |
| Freno de mano / drift | **Shift** |
| Bocina | **H** |
| Enderezar auto / centrar cámara | **R** |
| Pausar | **Espacio** (si no vuelas) / **Esc** / **P** / botón Pausa |

### Carga y fuerza

- **Carga** (~1.1 s para llegar al máximo): el medidor sobre la barra de poderes muestra el % de carga, la fuerza y la velocidad estimada del lanzamiento.
- **Fuerza** (5–100 %): escala todo, desde un **empujón suave** hasta un **lanzamiento enorme**. La velocidad de lanzamiento va de unos 9 km/h (fuerza mínima, sin carga) a más de 500 km/h (fuerza y carga máximas).
- **TK**: haz clic sobre un escombro, una pieza de auto o **cualquier auto** (intacto o chatarra) para agarrarlo; flota entre tú y la mira. Suelta para lanzarlo en arco hacia la mira. El daño es proporcional a **masa × velocidad**: un auto (masa 10) pega mucho más fuerte que un ladrillo.
- **Onda de choque / Aplastar / Slam**: mantener para cargar; el radio y el daño escalan con carga × fuerza.
- **Atrapar**: mientras mantienes Q, todo lo que vuela cerca de la mira o de ti (incluidos los proyectiles del rival) se **congela en el aire** durante ~5 s. Con **F** los rediriges todos juntos hacia la mira.

## iPhone 14 y Control Bluetooth

En el menú principal:

1. **Móvil · iPhone 14**: controles táctiles tipo **mando** (se activan solos en iPhone/iPad/Android, pantalla completa en horizontal o vertical).
   - **Pulgar izquierdo**: joystick (mover / conducir) y, encima, una **cruceta de poderes** (↑ TK · → Onda · ↓ Aplastar · ← Slam · centro 🛡 Escudo).
   - **Pulgar derecho**: rombo de 4 botones: **⚡ PODER** (grande, abajo: mantener = agarrar/cargar, arrastrar = apuntar, soltar = lanzar), **💥 Slam**, **🧊 Atrapar**, **↗ Redirigir**; al lado **🚗 Entrar**, **🛑 F.mano** (freno de mano) y **⟲** enderezar.
   - **Manejando** aparecen los **pedales**: **⬆ Acel.** (grande), **⬇ Freno** (frena y, ya parado, reversa) y **📯 bocina**. El joystick gira (y también acelera/frena). 🚀 Volar se oculta mientras manejas.
   - **Gatillos** en las esquinas: **L1 / R1** = zoom − / + (en 1.ª persona cambia el campo de visión), **L2 / R2** = girar cámara.
   - **🎥** (bajo L2/L1): cambia entre 1.ª persona → 3.ª persona cerca → 3.ª persona lejana. **Arrastrar en la pantalla = mirar** (arriba/abajo con límite) y todo se apunta con la **mira central** (✛).
   - **🚀 Volar** (a la derecha del joystick) y, mientras vuelas, **▲ / ▼** para la altura.
   - **👀 Láser** (arriba a la izquierda del rombo): mantener = rayos de los ojos hacia la mira; arrastrar sobre él = apuntar.
   - **⏸ Pausa** arriba al centro (en la pausa está *Fin sesión*). HUD compacto; los avisos aparecen una vez y se desvanecen.
   - **1 dedo** en el mapa 3D = mirar alrededor. **2 dedos**: pellizcar = zoom (distancia de cámara o FOV).
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

- **Tres cámaras** (🎥 / **V**):
  - **1.ª persona**: desde los ojos, sin el cuerpo y con manos psíquicas brillantes; dentro de un auto es la vista del conductor.
  - **3.ª persona cerca**: por encima del hombro.
  - **3.ª persona lejana** (por defecto): más atrás y más alta, para ver la destrucción; reemplaza la vista aérea original.
  - En 3.ª persona la cámara se acerca sola para no atravesar edificios (también la de persecución del auto). L1/R1 = distancia (FOV en 1.ª persona), L2/R2 = girar.
  - El joystick mueve relativo a hacia dónde miras. La sacudida de cámara funciona en todas.
- **Conduciendo**: cámara de persecución en tercera persona con retraso, y FOV que se abre con la velocidad. HUD de daño estilo Wreckfest más velocímetro.
- Iluminación: sombras PCF suaves que siguen al jugador, cielo con degradado, niebla e iluminación hemisférica. Explosiones con luces puntuales.
- Ciudad:
  - Calles texturizadas con líneas de carril, cruces peatonales, banquetas y alcantarillas.
  - Edificios por pisos con ventanas emisivas (InstancedMesh).
  - Los pisos colapsan en trozos que dejan pilas de escombro persistentes.
  - Grietas y cráteres en el asfalto.
- Partículas (polvo, humo, fuego, chispas, vidrio, energía psíquica) en dos capas de `Points` con shader propio y tope de 1800.
- Autos low-poly hechos con primitivas: abolladuras por vértice en el punto de impacto, vidrios que se agrietan y rompen, pintura chamuscada y piezas que se desprenden (capó, puertas, defensa, ruedas).

## Fluidez (v4.1)

- **Bucle de paso fijo** (60 Hz) con **interpolación** al dibujar: el movimiento se ve suave aunque el iPhone baje o suba de fps (máx. 3 pasos por cuadro, sin "espiral de la muerte").
- **Joystick flotante**: aparece donde pones el pulgar (toda la zona izquierda), con **zona muerta**, **curva exponencial** (control fino al centro) y suavizado; la base sigue al dedo si te sales del círculo.
- **Aceleración y giro suaves** del avatar: la velocidad y la orientación se acercan al objetivo de forma exponencial (sin tirones).
- **Cámara con resortes críticamente amortiguados** en todos los modos (1.ª, 3.ª cerca/lejos, persecución del auto, aérea): anticipa un poco hacia donde te mueves, se acerca al instante si hay un muro y se aleja despacio; los cambios de cámara se funden en 0.45 s.
- **Mirar suavizado** y **sensibilidad** ajustable (Pausa → *Sensibilidad*), guardada en el dispositivo.
- **Asistencia de mira** táctil (opcional, en Pausa): un leve "imán" hacia autos y escombros pesados cercanos al centro de la mira. La mira también se suaviza.
- **Manejo**: el volante se suaviza según la velocidad (más rápido = más estable) y los **pedales son analógicos**: un toque = 85 %, arrastrar hacia arriba/abajo = de 25 % a 100 % (se puede desactivar en Pausa).
- **Botones**: respuesta visual inmediata (brillo + escala), áreas táctiles más grandes que el dibujo, multitáctil fiable (joystick + mirar + poder a la vez), y nada se queda "pegado" (touchcancel, dedos huérfanos, cambio de app).
- **Rendimiento**: sin basura por cuadro en los bucles calientes (colisiones, entrada, cámara) y resolución máx. 1.5× en teléfonos.

## Autos (v4): física estilo GTA IV, daño y modelos

Implementación propia (no usa código de ningún juego):

- **Manejo pesado**: modelo de dos ejes con curva de agarre de neumático, transferencia de carga y círculo de fricción. Dirección lenta y sensible a la velocidad, **frenada larga**, el trasero se suelta con **freno de mano** (drift) o si frenas en plena curva.
- **Suspensión blanda**: resorte-amortiguador de rolido, cabeceo y rebote. El auto **se inclina mucho** en las curvas, **hunde la trompa al frenar** y se agacha al acelerar. Los choques y aterrizajes sacuden la suspensión.
- **Choques por masa**: impulso lineal **y angular** desde el punto de contacto (trompos). Un golpe lateral fuerte puede **volcar** al auto más liviano. Contra paredes rebota y gira según dónde pegue.
- **Deformación por vértice** en el punto de impacto: la chapa se hunde hacia adentro, el capó se arruga hacia arriba en choques frontales, el techo se aplasta en golpes desde arriba y la chapa tiembla un instante. Las abolladuras se acumulan (hasta 12 por auto).
- **Piezas que se sueltan**: paragolpes, puertas (queda el hueco oscuro), capó (se ve el vano del motor) y ruedas (el auto se apoya en el piso y saca chispas). Máximo 46 piezas sueltas en la ciudad (las más viejas desaparecen).
- **Vidrios** sanos → estrellados → rotos (lluvia de vidrio), **chispas** al rozar paredes u otros autos, **humo** con motor dañado, **fuego** y explosión cuando está destrozado.
- El tránsito IA, los autos estacionados y los que lanzas con TK reciben exactamente el mismo daño.
- **Modelos**: sedán, hatchback, SUV, pickup, deportivo, taxi, furgón y bus. Carrocería redondeada (secciones superelípticas), cabina con parantes, capó, puertas y paragolpes separados, llantas con rayos, faros y luces traseras emisivas (**se encienden fuerte al frenar**), pintura metalizada con reflejos (clearcoat en calidad alta), vidrios polarizados, espejos y patentes. Para el móvil: geometría unida por material y compartida por tipo, todas las ruedas en 2 draw calls (instanciadas), **LOD** a más de unos 58 m (1 malla) y deformación solo cerca de la cámara (máx. 2 autos por cuadro).
- **Sonido**: arranque y apagado del motor, rpm con 5 marchas simuladas, chirrido según derrape, choque, piezas que caen, rebote de llantas y bocina (lo que da `js/sfx.js`).

## Volar y láser (v3)

- **Volar**: levitas con aura y estela de energía. El joystick mueve en horizontal (más rápido que a pie); ▲/▼ suben y bajan hasta **1.5× el edificio más alto**, sin gravedad. Puedes pararte en las azoteas. Al desactivarlo caes, y si aterrizas desde lo alto hay **onda de choque** que daña lo cercano. Agarrar y lanzar sigue funcionando. Volar solo hace la recarga de energía un poco más lenta.
- **Láser de los ojos**: dos rayos rojo-naranja aditivos de los ojos a la mira. Corta columnas (rompe pisos y puede provocar el colapso), calienta los autos (arden y luego explotan), suelta chispas y humo, deja marcas de quemado en el asfalto y hace parpadear la luz. Gasta energía mientras lo mantienes.

## Gráficos (v3)

- Ventanas **emisivas** encendidas al azar (tonos cálidos y fríos, intensidad variable). Fachadas con balcones, marcos y manchas; azoteas con parapeto y ductos.
- Cielo con nubes procedurales; tone mapping ACES; sombra de contacto suave bajo el jugador (también al volar); humo y fuego con sprites suaves.
- **Bloom** opcional solo en calidad alta (`?q=high` o escritorio potente).

## Destrucción cinematográfica (v2.1)

- **Fractura irregular**: cada piso que cae suelta trozos de concreto/ladrillo de tamaños desiguales que salen girando hacia afuera, con chispas y vidrio.
- **Colapso estructural en cascada**: si ~22 % de las columnas de un edificio quedan debilitadas, el edificio entero **se hunde piso por piso** (cada vez más rápido), con polvo que escapa por el perímetro y una gran nube final que rueda por la calle, cráter y **polvo en el aire** (la niebla se vuelve terrosa y luego se despeja).
- **Explosiones** con domo de onda expansiva, anillo, destello, chispas, humo y sacudida de cámara proporcional.
- **Autos en llamas** durante 12–22 s, con humo negro y luz de fuego parpadeante.
- Los escombros **persisten** (con tope por rendimiento; los más viejos se vuelven montones estáticos).
- **Calidad automática**: alta en escritorio, media en táctil; si los FPS bajan de ~28 baja sola (sombras 2048→1024→512, partículas 1800→1100→650, menos trozos, menor resolución). Forzar con `?q=high|medium|low`.

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
  js/carmodel.js    — modelos de autos por tipo (loft), LOD, ruedas instanciadas, deformación
  js/textures.js    — texturas procedurales (calles, fachadas, grietas…)
  js/world.js       — mapa, edificios por pisos, props, escombro, explosiones
  js/physics.js     — cuerpos, partículas
  js/vehicles.js    — tipos de auto, física de manejo/suspensión, IA de carriles, daño, colisiones
  js/powers.js      — poderes, carga, fuerza, atrapar/redirigir
  js/npcs.js        — civiles, rival, oleadas
  js/ui.js          — menú / HUD
  js/mobile.js      — táctil iPhone 14 + Gamepad
  js/audio.js       — efectos Web Audio
  screens/          — capturas headless
```

## Créditos / aviso

Prototipo fan / sandbox educativo. No afiliado a City Smash ni Wreckfest.
