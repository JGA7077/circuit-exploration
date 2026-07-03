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
      case 'c':
      case 'pc': {
        const value = parseFloat(attrs.getNamedItem('c').value);
        const ref = `C${++refCount.C}`;
        components.push({ type: 'cap', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'd': {
        const moAttr = attrs.getNamedItem('mo');
        const model = moAttr ? moAttr.value : '1N4148';
        const ref = `D${++refCount.D}`;
        components.push({ type: 'diode', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: model, ref });
        break;
      }
      case 't': {
        const tVal = parseFloat(attrs.getNamedItem('t').value);
        const moAttr = attrs.getNamedItem('mo');
        const model = moAttr ? moAttr.value : (tVal > 0 ? 'NPN' : 'PNP');
        const ref = `Q${++refCount.Q}`;
        components.push({ type: tVal > 0 ? 'npn' : 'pnp', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: model, ref });
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

/**
 * Detecta a topologia do circuito.
 * Retorna { type, params } ou { type: 'unknown' }.
 */
export function detectTopology (circuit) {
  const components = circuit.components;
  const res = components.filter(c => c.type === 'res');
  const caps = components.filter(c => c.type === 'cap');
  const diodes = components.filter(c => c.type === 'diode');

  const trans = components.filter(c => c.type === 'npn' || c.type === 'pnp');

  // Mini-fuzz: transistor + 1+ diode + 1+ resistor + 1+ capacitor
  if (trans.length >= 1 && diodes.length >= 1 && res.length >= 1 && caps.length >= 1) {
    return {
      type: 'mini_fuzz',
      params: {
        transistor: trans[0].ref,
        diodeModel: diodes[0].value,
        numDiodes: diodes.length,
        numResistors: res.length,
        numCaps: caps.length
      }
    };
  }

  // Diode clipper: 1+ resistor + 1+ capacitor + 1+ diodo (no transistor)
  if (diodes.length >= 1 && res.length >= 1 && caps.length >= 1) {
    const firstR = res[0];
    const firstC = caps[0];
    const firstD = diodes[0];
    return {
      type: 'diode_clipper',
      params: {
        rValue: firstR.value,
        cValue: firstC.value,
        diodeModel: firstD.value,
        numDiodes: diodes.length,
        refs: { r: firstR.ref, c: firstC.ref, d: firstD.ref }
      }
    };
  }

  // RC low-pass: 1 resistor + 1 capacitor compartilhando um nó
  if (res.length === 1 && caps.length === 1) {
    const r = res[0];
    const c = caps[0];

    const sk1 = key(r.x1, r.y1);
    const sk2 = key(r.x2, r.y2);
    const ck = [key(c.x1, c.y1), key(c.x2, c.y2)];

    if (sk1 !== ck[0] && sk1 !== ck[1] && sk2 !== ck[0] && sk2 !== ck[1])
      return { type: 'unknown', reason: 'R and C do not share a node' };

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
function generateRCLowpass (topology) {
  const pluginName = 'CircuitPlugin';
  const paramName = 'cutoff';
  const paramLabel = 'Cutoff (Hz)';
  let defaultFc = Math.max(20, Math.min(20000, topology.params.cutoffHz));
  const paramRange = { min: 20, max: 20000, skew: 0.3 };

  let fcStr = defaultFc.toPrecision(3);
  if (!fcStr.includes('.')) fcStr += '.0';
  defaultFc = fcStr;

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

  return { processorH, processorCPP };
}

function generateDiodeClipper () {
  const pluginName = 'CircuitPlugin';

  const processorH = `#pragma once

#include <JuceHeader.h>
#include <chowdsp_wdf/chowdsp_wdf.h>

namespace wdft = chowdsp::wdft;

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
    struct WdfCircuit
    {
        void prepare (double fs);
        void reset();
        float processSample (float x);

        wdft::ResistiveVoltageSourceT<float> Vs;
        wdft::ResistorT<float> R1 { 4700.0f };
        wdft::WDFSeriesT<float, decltype(Vs), decltype(R1)> S1 { Vs, R1 };
        wdft::CapacitorT<float> C1 { 47.0e-9f };
        wdft::WDFParallelT<float, decltype(S1), decltype(C1)> P1 { S1, C1 };
        wdft::DiodePairT<float, decltype(P1)> dp { P1, 2.52e-9f };
    };

    WdfCircuit circuit[2];
    double sampleRate = 44100.0;
    float drive = 1.0f;
    float outputLevel = 1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${pluginName}AudioProcessor)
};
`;

  const processorCPP = `#include "${pluginName}Processor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("drive", "Drive (dB)",
        juce::NormalisableRange<float> (0.0f, 30.0f, 0.1f), 0.0f));
    layout.add (std::make_unique<juce::AudioParameterFloat> ("output", "Output (dB)",
        juce::NormalisableRange<float> (-30.0f, 6.0f, 0.1f), 0.0f));

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
    for (auto& c : circuit)
        c.prepare (rate);
}

void ${pluginName}AudioProcessor::releaseResources()
{
    for (auto& c : circuit)
        c.reset();
}

void ${pluginName}AudioProcessor::WdfCircuit::prepare (double fs)
{
    C1.prepare ((float) fs);
}

void ${pluginName}AudioProcessor::WdfCircuit::reset()
{
    C1.reset();
}

float ${pluginName}AudioProcessor::WdfCircuit::processSample (float x)
{
    Vs.setVoltage ((double) x);
    dp.incident (P1.reflected());
    auto y = wdft::voltage<float> (C1);
    P1.incident (dp.reflected());
    return y;
}

void ${pluginName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    drive = *apvts.getRawParameterValue ("drive");
    outputLevel = *apvts.getRawParameterValue ("output");

    float driveGain = juce::Decibels::decibelsToGain (drive);
    float outGain = juce::Decibels::decibelsToGain (outputLevel);

    for (int ch = 0; ch < totalNumInputChannels; ++ch)
    {
        auto* data = buffer.getWritePointer (ch);

        for (int s = 0; s < buffer.getNumSamples(); ++s)
        {
            float x = data[s] * driveGain;
            x = circuit[ch].processSample (x);
            data[s] = x * outGain;
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

  return { processorH, processorCPP };
}

function generateMiniFuzz () {
  const pluginName = 'CircuitPlugin';

  const processorH = `#pragma once

#include <JuceHeader.h>
#include <chowdsp_wdf/chowdsp_wdf.h>

namespace wdft = chowdsp::wdft;

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
    struct FuzzCircuit
    {
        void prepare (double fs);
        void reset();
        float processSample (float x);

        wdft::ResistiveVoltageSourceT<float> Vs;
        wdft::ResistorT<float> Rs { 4700.0f };
        wdft::WDFSeriesT<float, decltype(Vs), decltype(Rs)> S1 { Vs, Rs };
        wdft::ResistorT<float> Rload { 10000.0f };
        wdft::WDFParallelT<float, decltype(S1), decltype(Rload)> P1 { S1, Rload };
        wdft::CapacitorT<float> C1 { 1.0e-6f };
        wdft::WDFParallelT<float, decltype(P1), decltype(C1)> P2 { P1, C1 };
        wdft::DiodePairT<float, decltype(P2)> dp { P2, 2.52e-9f };
    };

    FuzzCircuit circuit[2];
    double sampleRate = 44100.0;
    float drive = 1.0f;
    float outputLevel = 1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${pluginName}AudioProcessor)
};
`;

  const processorCPP = `#include "${pluginName}Processor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("drive", "Drive",
        juce::NormalisableRange<float> (0.0f, 24.0f, 0.1f), 12.0f));
    layout.add (std::make_unique<juce::AudioParameterFloat> ("output", "Output",
        juce::NormalisableRange<float> (-24.0f, 24.0f, 0.1f), 0.0f));

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
    for (auto& c : circuit)
        c.prepare (rate);
}

void ${pluginName}AudioProcessor::releaseResources()
{
    for (auto& c : circuit)
        c.reset();
}

void ${pluginName}AudioProcessor::FuzzCircuit::prepare (double fs)
{
    C1.prepare ((float) fs);
}

void ${pluginName}AudioProcessor::FuzzCircuit::reset()
{
    C1.reset();
}

float ${pluginName}AudioProcessor::FuzzCircuit::processSample (float x)
{
    float v = std::tanh (x * 2.0f);
    Vs.setVoltage ((double) v);
    dp.incident (P2.reflected());
    auto y = wdft::voltage<float> (Rload);
    P2.incident (dp.reflected());
    return y;
}

void ${pluginName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    drive = *apvts.getRawParameterValue ("drive");
    outputLevel = *apvts.getRawParameterValue ("output");

    float driveGain = juce::Decibels::decibelsToGain (drive);
    float outGain = juce::Decibels::decibelsToGain (outputLevel);

    for (int ch = 0; ch < totalNumInputChannels; ++ch)
    {
        auto* data = buffer.getWritePointer (ch);

        for (int s = 0; s < buffer.getNumSamples(); ++s)
        {
            float x = data[s] * driveGain;
            x = circuit[ch].processSample (x);
            data[s] = x * outGain * 2.0f;
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

  return { processorH, processorCPP };
}

export function generatePluginSource (topology) {
  const pluginName = 'CircuitPlugin';

  let processorH, processorCPP;

  if (topology.type === 'rc_lowpass') {
    const gen = generateRCLowpass(topology);
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else if (topology.type === 'diode_clipper') {
    const gen = generateDiodeClipper();
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else if (topology.type === 'mini_fuzz') {
    const gen = generateMiniFuzz();
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else {
    const gen = generateRCLowpass({ type: 'rc_lowpass', params: { cutoffHz: 1000 } });
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  }

  const useWDF = topology.type === 'diode_clipper' || topology.type === 'mini_fuzz';

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
${useWDF ? `
FetchContent_Declare(chowdsp_wdf
    GIT_REPOSITORY https://github.com/Chowdhury-DSP/chowdsp_wdf.git
    GIT_TAG main
)
set(CHOWDSP_WDF_BUILD_TESTS OFF CACHE BOOL "")
FetchContent_MakeAvailable(chowdsp_wdf)
` : ''}
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
${useWDF ? 'target_link_libraries(${pluginName} PRIVATE chowdsp::chowdsp_wdf)' : ''}
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
