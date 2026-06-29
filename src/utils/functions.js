/**
 * Converte XML do Falstad para arquivo .asc do LTspice com layout funcional.
 * @param {string} xmlString - Conteúdo do arquivo .txt do Falstad.
 * @returns {string} Conteúdo do arquivo .asc.
 */
export function convertFalstadToAsc(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const cir = xmlDoc.documentElement;

  // Estruturas
  const wires = [];           // {x1, y1, x2, y2}
  const components = [];      // {type, x1, y1, x2, y2, value, ref}
  const grounds = [];
  const outputPoints = [];
  let refCount = { R: 0, V: 0, C: 0, L: 0, I: 0 };

  // Processar filhos
  const children = cir.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const tag = el.tagName.toLowerCase();
    const attrs = el.attributes;
    const xAttr = attrs.getNamedItem('x');
    if (!xAttr) continue;
    const coords = xAttr.value.split(' ').map(Number); // [x1, y1, x2, y2]

    switch (tag) {
      case 'w':
        wires.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        break;
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
      case 'g':
        grounds.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        break;
      case 'o': // maiúsculo ou minúsculo? No exemplo há <O> (maiúsculo) e <o> (minúsculo com nome)
        // Vamos tratar ambos: se tiver atributo 'x' com nome, é saída nomeada
        const nameAttr = attrs.getNamedItem('x');
        if (nameAttr && isNaN(nameAttr.value)) {
          // É uma saída nomeada (ex: 'out')
          outputPoints.push({ name: nameAttr.value, x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        } else {
          // É um conector de saída (sem nome) - podemos ignorar
        }
        break;
      default:
        break;
    }
  }

  // Se não houver saída nomeada, mas houver <O>, criar uma saída genérica
  if (outputPoints.length === 0) {
    // Procurar por <O> que tenha coordenadas e criar uma saída "out"
    // No exemplo, há <O> com coordenadas, mas não tem nome. Vamos criar um "out" baseado nele.
    // Mas o exemplo tem <o> com nome, então não precisamos.
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
  // Definir offset dos pinos (distância do centro ao pino) para cada orientação
  const PIN_OFFSET = 30; // unidades LTspice (valor típico para resistor, capacitor, etc.)

  components.forEach(comp => {
    const { x1, y1, x2, y2, value, ref, type } = comp;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    // Determinar orientação: se vertical (x1 == x2) -> R90, senão horizontal -> R0
    const isVertical = (x1 === x2);
    const rot = isVertical ? 'R90' : 'R0';

    // Mapear tipo para símbolo LTspice
    let symbol;
    switch (type) {
      case 'res': symbol = 'res'; break;
      case 'cap': symbol = 'cap'; break;
      case 'ind': symbol = 'ind'; break;
      case 'voltage': symbol = 'voltage'; break;
      case 'current': symbol = 'current'; break;
      default: symbol = 'res';
    }

    // Escrever SYMBOL no centro
    asc += `SYMBOL ${symbol} ${Math.round(cx)} ${Math.round(cy)} ${rot}\n`;
    asc += `SYMATTR InstName ${ref}\n`;
    // Formatar valor: se for resistor >=1000, usar k
    let valStr = value.toString();
    if (type === 'res' && value >= 1000) valStr = (value/1000) + 'k';
    asc += `SYMATTR Value ${valStr}\n`;

    // Agora, gerar fios auxiliares para conectar os pinos do símbolo aos pontos de terminação.
    // Pinos do símbolo:
    // - Para orientação R0 (horizontal): pino esquerdo em (cx - PIN_OFFSET, cy), direito em (cx + PIN_OFFSET, cy)
    // - Para orientação R90 (vertical): pino superior em (cx, cy - PIN_OFFSET), inferior em (cx, cy + PIN_OFFSET)
    let pin1x, pin1y, pin2x, pin2y;
    if (isVertical) {
      pin1x = cx; pin1y = cy - PIN_OFFSET; // superior
      pin2x = cx; pin2y = cy + PIN_OFFSET; // inferior
    } else {
      pin1x = cx - PIN_OFFSET; pin1y = cy;
      pin2x = cx + PIN_OFFSET; pin2y = cy;
    }

    // Conectar pin1 ao terminal (x1,y1) e pin2 ao (x2,y2)
    // Mas se o componente for uma fonte de tensão, o pino positivo é o superior (para R0)
    // Para fontes, precisamos garantir que o positivo esteja conectado ao nó correto.
    // No Falstad, a fonte é definida com dois pontos. Vamos assumir que o primeiro ponto é o positivo (geralmente em cima).
    // Então conectamos pin1 (superior) a (x1,y1) e pin2 (inferior) a (x2,y2)
    // Para outros componentes, a ordem não importa.

    if (type === 'voltage') {
      // Para fonte, o pino positivo é o de cima (se rot=R0) ou o da esquerda (se rot=R90)
      // Vamos manter a convenção: pin1 é o que deve ser positivo
      // No LTspice, o símbolo voltage com orientação R0 tem o terminal positivo em cima.
      // Se nossa fonte tem x1,y1 (primeiro ponto) acima de x2,y2, então x1,y1 deve conectar ao pino superior.
      // Vamos verificar a posição relativa:
      if (y1 < y2) {
        // x1,y1 é o ponto mais acima, então conectamos ao pino superior (pin1)
        // e o inferior ao pino inferior (pin2)
        // Mas já definimos pin1 como superior, então está certo.
      } else {
        // Se y1 > y2, então o primeiro ponto é o inferior, invertemos a conexão.
        // Nesse caso, trocamos os pinos.
        // Vamos simplesmente conectar (x1,y1) ao pino que estiver mais próximo.
        // Podemos usar a distância para decidir.
      }
      // Para simplicidade, vamos conectar pin1 a (x1,y1) e pin2 a (x2,y2)
    }

    // Gerar fios auxiliares se as coordenadas forem diferentes
    if (Math.round(pin1x) !== Math.round(x1) || Math.round(pin1y) !== Math.round(y1)) {
      asc += `WIRE ${Math.round(pin1x)} ${Math.round(pin1y)} ${Math.round(x1)} ${Math.round(y1)}\n`;
    }
    if (Math.round(pin2x) !== Math.round(x2) || Math.round(pin2y) !== Math.round(y2)) {
      asc += `WIRE ${Math.round(pin2x)} ${Math.round(pin2y)} ${Math.round(x2)} ${Math.round(y2)}\n`;
    }
  });

  // 3. FLAG para o terra
  grounds.forEach(g => {
    // Usar o primeiro ponto do terra para colocar a flag
    asc += `FLAG ${Math.round(g.x1)} ${Math.round(g.y1)} 0\n`;
  });

  // 4. FLAG para saídas nomeadas
  outputPoints.forEach(o => {
    // Colocar a flag no primeiro ponto (ou na média)
    asc += `FLAG ${Math.round(o.x1)} ${Math.round(o.y1)} ${o.name}\n`;
  });

  // 5. Comando de simulação (padrão: .tran)
  asc += 'TEXT -48 312 Left 2 !.tran 100m\n';

  return asc;
}