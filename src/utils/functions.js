/**
 * Converte XML do Falstad para arquivo .asc do LTspice com layout funcional.
 * @param {string} xmlString - Conteúdo do arquivo .txt do Falstad.
 * @returns {string} Conteúdo do arquivo .asc.
 */
export function convertFalstadToAsc(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const cir = xmlDoc.documentElement;

  // 1. Coletar os nomes das saídas configuradas (tags <o> que não têm coordenadas, mas têm nome no atributo x)
  const outputNames = [];
  const oConfigs = cir.getElementsByTagName('o');
  for (let i = 0; i < oConfigs.length; i++) {
    const el = oConfigs[i];
    const xAttr = el.getAttribute('x');
    // Se o xAttr existe e não contém espaços (não é coordenada), é o nome da saída
    if (xAttr && !xAttr.includes(' ')) {
      outputNames.push(xAttr);
    }
  }

  // Estruturas
  const wires = [];           // {x1, y1, x2, y2}
  const components = [];      // {type, x1, y1, x2, y2, value, ref}
  const grounds = [];
  const outputPoints = [];
  let refCount = { R: 0, V: 0, C: 0, L: 0, I: 0, D: 0, POT: 0, PC: 0 };
  let oProbeIndex = 0;
  // armazenar coordenadas do wiper de potenciômetros para ligar ao probe
  const potWipers = [];

  // Processar filhos
  const children = cir.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const tag = el.tagName; // manter case original
    const attrs = el.attributes;
    const xAttr = attrs.getNamedItem('x');
    if (!xAttr) continue;
    const xVal = xAttr.value;

    // Verificar se é uma lista de coordenadas
    if (!xVal.includes(' ')) continue;

    const coords = xVal.split(' ').map(Number);
    if (coords.some(isNaN)) continue;

    // Se a tag for 'O' (maiúsculo) ou 'o' com coordenadas, é o componente de sonda/saída
    if (tag === 'O' || (tag === 'o' && coords.length >= 2)) {
      const name = outputNames[oProbeIndex++] || `out${oProbeIndex}`;
      outputPoints.push({ name, x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
      // Adicionamos o fio físico correspondente à sonda para conectá-la ao circuito
      wires.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
      // Se houver um wiper de potenciômetro pendente, conectar ao ponto de entrada do probe (primeiro ponto)
      if (potWipers.length > 0) {
        const w = potWipers.shift();
        wires.push({ x1: w.wiperX, y1: w.wiperY, x2: coords[0], y2: coords[1] });
      }
      continue;
    }

    switch (tag.toLowerCase()) {
      case 'w':
        wires.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        break;
      case 'pt': {
        const maAttr = attrs.getNamedItem('ma');
        const R_total = maAttr ? parseFloat(maAttr.value) : 10000;
        const poAttr = attrs.getNamedItem('po');
        const pos = poAttr ? parseFloat(poAttr.value) : 0.5;
        const ref = `POT${++refCount.POT}`;

        const dx = coords[2] - coords[0];
        const dy = coords[3] - coords[1];
        let rx1_top, ry1_top, rx2_top, ry2_top;
        let rx1_bot, ry1_bot, rx2_bot, ry2_bot;

        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical
          const wiperX = coords[2];
          const wiperY = (coords[1] + coords[3]) / 2;

          // Resistor A (top: de top terminal (x1, y2) para wiper)
          rx1_top = coords[0]; ry1_top = coords[3];
          rx2_top = wiperX; ry2_top = wiperY;

          // Resistor B (bottom: de wiper para bottom terminal (x1, y1))
          rx1_bot = wiperX; ry1_bot = wiperY;
          rx2_bot = coords[0]; ry2_bot = coords[1];
        } else {
          // Horizontal
          const wiperX = (coords[0] + coords[2]) / 2;
          const wiperY = coords[3];

          // Resistor A (left: de left terminal (x1, y1) para wiper)
          rx1_top = coords[0]; ry1_top = coords[1];
          rx2_top = wiperX; ry2_top = wiperY;

          // Resistor B (right: de wiper para right terminal (x2, y1))
          rx1_bot = wiperX; ry1_bot = wiperY;
          rx2_bot = coords[2]; ry2_bot = coords[1];
        }

        const value_top = Math.round(R_total * (1 - pos));
        const value_bot = Math.round(R_total * pos);

        components.push({ type: 'res', x1: rx1_top, y1: ry1_top, x2: rx2_top, y2: ry2_top, value: value_top, ref: `${ref}_A` });
        components.push({ type: 'res', x1: rx1_bot, y1: ry1_bot, x2: rx2_bot, y2: ry2_bot, value: value_bot, ref: `${ref}_B` });
        break;
      }
      case 'r': {
        const value = parseFloat(attrs.getNamedItem('r').value);
        const ref = `R${++refCount.R}`;
        components.push({ type: 'res', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'c': {
        const value = parseFloat(attrs.getNamedItem('c').value);
        const ref = `C${++refCount.C}`;
        components.push({ type: 'cap', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'pc': {
        const value = parseFloat(attrs.getNamedItem('c').value);
        const ref = `C${++refCount.C}`;
        components.push({ type: 'polcap', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'l': {
        const value = parseFloat(attrs.getNamedItem('l').value);
        const ref = `L${++refCount.L}`;
        components.push({ type: 'ind', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'v': {
        const maxv = parseFloat(attrs.getNamedItem('maxv').value);
        const ref = `V${++refCount.V}`;
        components.push({ type: 'voltage', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: maxv, ref });
        break;
      }
      case 'i': {
        const maxi = parseFloat(attrs.getNamedItem('maxi').value);
        const ref = `I${++refCount.I}`;
        components.push({ type: 'current', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: maxi, ref });
        break;
      }
      case 'd': {
        const ref = `D${++refCount.D}`;
        components.push({ type: 'diode', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: '1N4148', ref });
        break;
      }
      case 'g':
        grounds.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        break;
      default:
        break;
    }
  }

  // Definições de pinos padrão no LTSpice (orientação R0)
  // Cada símbolo tem pinos em (px, py) relativos à sua origem.
  const SYMBOL_PINS = {
    res: { p1: { x: 16, y: 16 }, p2: { x: 16, y: 96 } },
    cap: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 64 } },
    polcap: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 64 } },
    ind: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 80 } },
    voltage: { p1: { x: 0, y: -80 }, p2: { x: 0, y: 96 } },
    current: { p1: { x: 0, y: -80 }, p2: { x: 0, y: 96 } },
    diode: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 64 } }
  };

  // Função para rotacionar um ponto (x, y) 90/180/270 graus no sentido horário
  function rotatePoint(pt, rot) {
    if (rot === 'R90') return { x: -pt.y, y: pt.x };
    if (rot === 'R180') return { x: -pt.x, y: -pt.y };
    if (rot === 'R270') return { x: pt.y, y: -pt.x };
    return { x: pt.x, y: pt.y };
  }
  // Função para formatar valores em notação de engenharia do LTSpice
  // Usa 'u' (ASCII) ao invés de 'µ' (Unicode) para compatibilidade com .asc
  function formatValue(val, type) {
    if (typeof val === 'string') return val; // ex: '1N4148'

    // Capacitores e indutores: valores em Farad/Henry (tipicamente frações pequenas)
    if (type === 'cap' || type === 'polcap') {
      if (val >= 1) return parseFloat(val.toPrecision(6)) + '';
      if (val >= 1e-3) return parseFloat((val * 1e3).toPrecision(6)) + 'm';
      if (val >= 1e-6) return parseFloat((val * 1e6).toPrecision(6)) + 'u';
      if (val >= 1e-9) return parseFloat((val * 1e9).toPrecision(6)) + 'n';
      if (val >= 1e-12) return parseFloat((val * 1e12).toPrecision(6)) + 'p';
      return val.toExponential();
    }
    if (type === 'ind') {
      if (val >= 1) return parseFloat(val.toPrecision(6)) + '';
      if (val >= 1e-3) return parseFloat((val * 1e3).toPrecision(6)) + 'm';
      if (val >= 1e-6) return parseFloat((val * 1e6).toPrecision(6)) + 'u';
      if (val >= 1e-9) return parseFloat((val * 1e9).toPrecision(6)) + 'n';
      return val.toExponential();
    }
    // Resistores
    if (type === 'res') {
      if (val >= 1e6) return parseFloat((val / 1e6).toPrecision(6)) + 'Meg';
      if (val >= 1e3) return parseFloat((val / 1e3).toPrecision(6)) + 'k';
      return parseFloat(val.toPrecision(6)) + '';
    }
    return val.toString();
  }

  // Construir o .asc
  let asc = '';
  asc += 'Version 4.1\n';
  asc += 'SHEET 1 880 680\n';

  // 1. Gerar WIREs para todos os fios do Falstad
  wires.forEach(w => {
    asc += `WIRE ${Math.round(w.x1)} ${Math.round(w.y1)} ${Math.round(w.x2)} ${Math.round(w.y2)}\n`;
  });

  // 2. Para cada componente, posicionar símbolo e gerar fios de conexão
  components.forEach(comp => {
    const { x1, y1, x2, y2, value, ref, type } = comp;

    // Determinar rotação e orientação baseada na direção no Falstad
    const dx = x2 - x1;
    const dy = y2 - y1;
    let rot = 'R0';
    if (Math.abs(dx) > Math.abs(dy)) {
      rot = 'R90';
    } else {
      rot = 'R0';
    }

    const pinConfig = SYMBOL_PINS[type] || SYMBOL_PINS.res;

    // Rotacionar os offsets dos pinos para a orientação desejada
    const rPin1 = rotatePoint(pinConfig.p1, rot);
    const rPin2 = rotatePoint(pinConfig.p2, rot);

    // Ancorar o símbolo de modo que pin1 fique EXATAMENTE em (x1, y1).
    // Isso garante conexão direta sem fio extra no pin1.
    const sx = Math.round(x1 - rPin1.x);
    const sy = Math.round(y1 - rPin1.y);

    // Coordenadas finais dos pinos do símbolo inserido
    const pin1x = sx + rPin1.x; // = x1 (por construção)
    const pin1y = sy + rPin1.y; // = y1 (por construção)
    const pin2x = sx + rPin2.x;
    const pin2y = sy + rPin2.y;

    // Escrever SYMBOL
    asc += `SYMBOL ${type} ${sx} ${sy} ${rot}\n`;
    asc += `SYMATTR InstName ${ref}\n`;

    let valStr = formatValue(value, type);
    asc += `SYMATTR Value ${valStr}\n`;

    // Gerar fio apenas do pin2 ao ponto (x2, y2) do Falstad
    // O pin1 já está em (x1, y1) — não precisa de fio extra
    if (pin2x !== Math.round(x2) || pin2y !== Math.round(y2)) {
      asc += `WIRE ${Math.round(pin2x)} ${Math.round(pin2y)} ${Math.round(x2)} ${Math.round(y2)}\n`;
    }
  });

  // 3. FLAG para o terra
  grounds.forEach(g => {
    asc += `FLAG ${Math.round(g.x1)} ${Math.round(g.y1)} 0\n`;
  });

  // 4. FLAG para saídas nomeadas
  outputPoints.forEach(o => {
    asc += `FLAG ${Math.round(o.x2)} ${Math.round(o.y2)} ${o.name}\n`;
  });

  // 5. Comando de simulação padrão
  asc += 'TEXT -48 312 Left 2 !.tran 100m\n';

  return asc;
}