/**
 * circuitToVST3.js
 * 
 * Converte um circuito Falstad (XML) em um plugin VST3 (JUCE/C++).
 * 
 * Fase 1: detecção de filtro RC passa-baixas → gera 1-pole IIR.
 * Fase 2+: parser MNA completo para topologias arbitrárias.
 * 
 * Uso (Node.js):
 *   node src/utils/circuitToVST3.js < input.xml
 * 
 * Uso (browser):
 *   import { generatePlugin } from './utils/circuitToVST3.js';
 *   const result = generatePlugin(xmlString);
 */

// ---------------------------------------------------------------------------
// Parser de XML Falstad
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FalstadComponent
 * @property {string} type - 'res' | 'cap' | 'voltage' | 'ind' | 'diode' | 'npn' | 'pnp'
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {number|string} value
 * @property {string} ref
 */

/**
 * @typedef {Object} FalstadWire
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {Object} FalstadCircuit
 * @property {FalstadComponent[]} components
 * @property {FalstadWire[]} wires
 * @property {{x:number,y:number}[]} grounds
 * @property {{name:string,x1:number,y1:number,x2:number,y2:number}[]} outputs
 */

/**
 * Extrai componentes, fios e terras do XML Falstad.
 * @param {string} xmlString
 * @param {object} [customDOMParser] - Instância DOMParser (obrigatório no Node.js)
 */
export function parseFalstadXml (xmlString, customDOMParser) {
  const parser = customDOMParser || (typeof DOMParser !== 'undefined' ? new DOMParser() : null);
  if (!parser) throw new Error('DOMParser not available. Pass customDOMParser or run in browser.');

  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const cir = xmlDoc.documentElement;

  const wires = [];
  const components = [];
  const grounds = [];
  const outputs = [];
  const outputNames = [];

  const refCount = { R: 0, V: 0, C: 0, L: 0, I: 0, D: 0, Q: 0 };

  // Coletar nomes de saída (tags <o> sem coordenadas)
  const oConfigs = cir.getElementsByTagName('o');
  for (let i = 0; i < oConfigs.length; i++) {
    const el = oConfigs[i];
    const xAttr = el.getAttribute('x');
    if (xAttr && !xAttr.includes(' ')) {
      outputNames.push(xAttr);
    }
  }

  let oProbeIndex = 0;
  const children = cir.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const tag = el.tagName;
    const attrs = el.attributes;

    const xAttr = attrs.getNamedItem('x');
    if (!xAttr) continue;
    let xVal = xAttr.value.replace(/\u00a0/g, ' ');
    if (!xVal.includes(' ')) continue;

    const coords = xVal.split(' ').map(Number);
    if (coords.some(isNaN)) continue;

    if (tag === 'O' || (tag === 'o' && coords.length >= 2)) {
      const name = outputNames[oProbeIndex++] || `out${oProbeIndex}`;
      outputs.push({ name, x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
      wires.push({ x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
      continue;
    }

    switch (tag.toLowerCase()) {
      case 'w':
      case 'rw':
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
      case 'g':
        grounds.push({ x: coords[0], y: coords[1] });
        break;
      default:
        break;
    }
  }

  return { wires, components, grounds, outputs };
}

// ---------------------------------------------------------------------------
// Topologia: detecção de filtro RC passa-baixas
// ---------------------------------------------------------------------------

/**
 * Constrói um mapa de nós a partir de fios e componentes.
 * Cada nó é identificado por uma coordenada (x,y).
 * Retorna { nodeMap, nodeOfCoord } onde nodeMap[n] = [{type, ref, pin}, ...]
 */
function buildNodeMap ({ wires, components, grounds }) {
  // Agrupar coordenadas conectadas por fios (flood fill)
  const adj = new Map(); // "x,y" → Set de "x2,y2"
  const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

  function addEdge (x1, y1, x2, y2) {
    const k1 = key(x1, y1), k2 = key(x2, y2);
    if (k1 === k2) return;
    if (!adj.has(k1)) adj.set(k1, new Set());
    if (!adj.has(k2)) adj.set(k2, new Set());
    adj.get(k1).add(k2);
    adj.get(k2).add(k1);
  }

  wires.forEach(w => addEdge(w.x1, w.y1, w.x2, w.y2));

  // Adicionar terminais de componentes como conectados a si mesmos
  components.forEach(c => {
    if (!adj.has(key(c.x1, c.y1))) adj.set(key(c.x1, c.y1), new Set());
    if (!adj.has(key(c.x2, c.y2))) adj.set(key(c.x2, c.y2), new Set());
  });
  grounds.forEach(g => {
    if (!adj.has(key(g.x, g.y))) adj.set(key(g.x, g.y), new Set());
  });

  // Flood fill para agrupar nós conectados
  const visited = new Set();
  const nodeMap = new Map(); // nodeId → [{type, ref, pin, x, y}, ...]
  const nodeOfCoord = new Map(); // "x,y" → nodeId

  let nextNodeId = 0;
  for (const [k] of adj) {
    if (visited.has(k)) continue;
    const stack = [k];
    const group = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      group.push(cur);
      for (const nb of (adj.get(cur) || [])) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    const nodeId = nextNodeId++;
    group.forEach(coord => { nodeOfCoord.set(coord, nodeId); });
    nodeMap.set(nodeId, []);
  }

  // Associar componentes aos nós
  components.forEach(c => {
    const n1 = nodeOfCoord.get(key(c.x1, c.y1));
    const n2 = nodeOfCoord.get(key(c.x2, c.y2));
    if (n1 !== undefined && nodeMap.has(n1)) nodeMap.get(n1).push({ type: c.type, ref: c.ref, pin: 1, x: c.x1, y: c.y1 });
    if (n2 !== undefined && nodeMap.has(n2)) nodeMap.get(n2).push({ type: c.type, ref: c.ref, pin: 2, x: c.x2, y: c.y2 });
  });

  // Associar grounds aos nós
  grounds.forEach(g => {
    const n = nodeOfCoord.get(key(g.x, g.y));
    if (n !== undefined && nodeMap.has(n)) nodeMap.get(n).push({ type: 'gnd', ref: '0', pin: 0, x: g.x, y: g.y });
  });

  return { nodeMap, nodeOfCoord };
}

/**
 * Detecta a topologia do circuito.
 * Retorna { type, params } ou { type: 'unknown' }.
 */
export function detectTopology (circuit) {
  const { nodeMap } = buildNodeMap(circuit);
  const components = circuit.components;
  const res = components.filter(c => c.type === 'res');
  const caps = components.filter(c => c.type === 'cap');

  // RC low-pass: 1 resistor + 1 capacitor compartilhando um nó
  if (res.length === 1 && caps.length === 1) {
    const r = res[0];
    const c = caps[0];

    // Verificar que R e C compartilham um terminal
    const sharedKey1 = key(r.x1, r.y1);
    const sharedKey2 = key(r.x2, r.y2);

    const ck1 = key(c.x1, c.y1);
    const ck2 = key(c.x2, c.y2);

    let midNode, inKey, outKey;
    if (sharedKey1 === ck1 || sharedKey1 === ck2) {
      midNode = sharedKey1;
      inKey = sharedKey2;
    } else if (sharedKey2 === ck1 || sharedKey2 === ck2) {
      midNode = sharedKey2;
      inKey = sharedKey1;
    } else {
      return { type: 'unknown', reason: 'R and C do not share a node' };
    }

    const sharedCKeys = [ck1, ck2];
    const cOtherKey = sharedCKeys.find(k => k !== midNode);

    // Verificar ground no terminal livre do capacitor
    const { nodeOfCoord } = buildNodeMap(circuit);
    const gndKey = circuit.grounds.length > 0
      ? key(circuit.grounds[0].x, circuit.grounds[0].y)
      : null;

    const fc = 1.0 / (2.0 * Math.PI * r.value * c.value);

    return {
      type: 'rc_lowpass',
      params: {
        rValue: r.value,
        cValue: c.value,
        cutoffHz: fc,
        refs: { r: r.ref, c: c.ref }
      }
    };
  }

  return { type: 'unknown', reason: 'Unsupported topology' };
}

function key (x, y) {
  return `${Math.round(x)},${Math.round(y)}`;
}

// ---------------------------------------------------------------------------
// Geração de código C++ (JUCE)
// ---------------------------------------------------------------------------

/**
 * Gera os arquivos fonte do plugin JUCE a partir da topologia detectada.
 * @returns {{ [filename: string]: string }}
 */
export function generatePluginSource (topology) {
  const paramName = 'cutoff';
  const paramLabel = 'Cutoff (Hz)';
  let defaultFc, paramRange;

  if (topology.type === 'rc_lowpass') {
    defaultFc = topology.params.cutoffHz;
  } else {
    defaultFc = 1000;
  }

  // Limitar faixa do parâmetro
  defaultFc = Math.max(20, Math.min(20000, defaultFc));
  paramRange = { min: 20, max: 20000, skew: 0.3 };

    // Formatar como literal float C++ válido (sempre com ponto decimal)
  let fcStr = defaultFc.toPrecision(3);
  // Garantir que tenha ponto decimal (ex: 159 → 159.0)
  if (!fcStr.includes('.')) fcStr += '.0';
  defaultFc = fcStr;

  const pluginName = 'CircuitPlugin';
  const processorH = `#pragma once

#include <JuceHeader.h>
#include <vector>

class ${pluginName}AudioProcessor : public juce::AudioProcessor
{
public:
    ${pluginName}AudioProcessor();
    ~${pluginName}AudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return false; }

    const juce::String getName() const override { return "${pluginName}"; }

    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;

private:
    void updateCoefficients (double sampleRate);

    double sampleRate = 44100.0;
    std::vector<float> z1;
    float b0 = 0.0f;
    float a1 = 0.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${pluginName}AudioProcessor)
};
`;

  const processorCPP = `#include "${pluginName}Processor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("${paramName}", "${paramLabel}",
        juce::NormalisableRange<float> (${paramRange.min}.0f, ${paramRange.max}.0f, 1.0f, ${paramRange.skew}f), ${defaultFc}f));

    return layout;
}

${pluginName}AudioProcessor::${pluginName}AudioProcessor()
    : AudioProcessor (BusesProperties().withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                                       .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

void ${pluginName}AudioProcessor::prepareToPlay (double rate, int)
{
    sampleRate = rate;
    auto numChannels = getTotalNumInputChannels();
    z1.assign (numChannels, 0.0f);
    updateCoefficients (rate);
}

void ${pluginName}AudioProcessor::releaseResources()
{
    z1.clear();
}

void ${pluginName}AudioProcessor::updateCoefficients (double fs)
{
    float fc = *apvts.getRawParameterValue ("${paramName}");
    if (fc < 1.0f) fc = 1.0f;
    if (fc >= (float)fs * 0.49f) fc = (float)fs * 0.49f;

    // 1-pole RC low-pass: y[n] = a * x[n] + (1-a) * y[n-1]
    float a = 1.0f - std::exp (-2.0f * juce::MathConstants<float>::pi * fc / (float)fs);
    b0 = a;
    a1 = 1.0f - a;
}

void ${pluginName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    updateCoefficients (sampleRate);

    for (int channel = 0; channel < totalNumInputChannels; ++channel)
    {
        auto* data = buffer.getWritePointer (channel);
        auto& state = z1[(size_t)channel];

        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
        {
            float in = data[sample];
            float out = b0 * in + a1 * state;
            state = out;
            data[sample] = out;
        }
    }
}

juce::AudioProcessorEditor* ${pluginName}AudioProcessor::createEditor()
{
    return nullptr;
}

void ${pluginName}AudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::MemoryOutputStream mos (destData, false);
    apvts.state.writeToStream (mos);
}

void ${pluginName}AudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto tree = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);
    if (tree.isValid())
        apvts.replaceState (tree);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ${pluginName}AudioProcessor();
}
`;

  const cmakeLists = `cmake_minimum_required(VERSION 3.20)
project(${pluginName} VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG master
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(${pluginName}
    COMPANY_NAME "CircuitExploration"
    PLUGIN_MANUFACTURER_CODE CExp
    PLUGIN_CODE Ckt1
    FORMATS VST3
    NEEDS_MIDI_INPUT OFF
    NEEDS_MIDI_OUTPUT OFF
    IS_SYNTH OFF
    EDITOR_REQUIRED OFF
)

juce_generate_juce_header(${pluginName})

target_sources(${pluginName}
    PRIVATE
        ${pluginName}Processor.cpp
        ${pluginName}Processor.h
)

target_compile_definitions(${pluginName} PRIVATE
    JUCE_IGNORE_VST3_MISMATCHED_PARAMETER_ID_WARNING=1
)
`;

  const moduleInfo = `{
    "Version": 1,
    "Plugin": "${pluginName}",
    "Category": "Fx"
}
`;

  return {
    'CMakeLists.txt': cmakeLists,
    [`${pluginName}Processor.h`]: processorH,
    [`${pluginName}Processor.cpp`]: processorCPP,
    'moduleinfo.json': moduleInfo
  };
}

// ---------------------------------------------------------------------------
// Geração completa do projeto
// ---------------------------------------------------------------------------

/**
 * Gera um projeto VST3 completo a partir de um XML Falstad.
 * @param {string} xmlString - XML do Falstad
 * @returns {{ sources: {[filename]:string}, topology: object, circuit: object }}
 */
export function generatePlugin (xmlString, customDOMParser) {
  const circuit = parseFalstadXml(xmlString, customDOMParser);
  const topology = detectTopology(circuit);
  const sources = generatePluginSource(topology);
  return { sources, topology, circuit };
}

// ---------------------------------------------------------------------------
// CLI (Node.js)
// ---------------------------------------------------------------------------

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('circuitToVST3.js')) {
  let input = '';
  if (process.stdin.isTTY) {
    console.error('Usage: node src/utils/circuitToVST3.js < circuit.xml');
    process.exit(1);
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const result = generatePlugin(input);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });
}
