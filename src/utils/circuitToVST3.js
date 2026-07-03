/**
 * circuitToVST3.js
 * 
 * Converte um circuito Falstad (XML) em um plugin VST3 (JUCE/C++).
 * 
 * Fase 1: detecção de filtro RC passa-baixas → gera 1-pole IIR.
 * Fase 2: diode clipper e mini-fuzz com WDF.
 * Fase 3: parser MNA completo para topologias arbitrárias.
 * 
 * Uso (Node.js):
 *   node src/utils/circuitToVST3.js < input.xml
 * 
 * Uso (browser):
 *   import { generatePlugin } from './utils/circuitToVST3.js';
 *   const result = generatePlugin(xmlString);
 */

import { buildNetlist, analyzeParameters } from './mnaSolver.js';

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

  // Parse attributes helper
  const getAttr = (el, name) => {
    const a = el.attributes.getNamedItem(name);
    return a ? a.value : null;
  };
  const getFloat = (el, name, def = 0) => {
    const v = getAttr(el, name);
    return v !== null ? parseFloat(v) : def;
  };

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
      case 'l': {
        const value = parseFloat(getAttr(el, 'l') || getAttr(el, 'value') || '0.001');
        const ref = `L${++refCount.L}`;
        components.push({ type: 'ind', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value, ref });
        break;
      }
      case 'v':
      case 'vs': {
        const dcValue = getFloat(el, 'v', 5);
        const ref = `V${++refCount.V}`;
        components.push({ type: 'voltage', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: dcValue, dcValue, ref });
        break;
      }
      case 'sine': {
        const dcValue = getFloat(el, 'v', 0);
        const acAmplitude = getFloat(el, 'a', 1);
        const acFrequency = getFloat(el, 'f', 1000);
        const ref = `V${++refCount.V}`;
        components.push({ type: 'sine', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: dcValue, dcValue, acAmplitude, acFrequency, ref });
        break;
      }
      case 'var': {
        const dcValue = getFloat(el, 'v', 5);
        const ref = `V${++refCount.V}`;
        components.push({ type: 'voltage', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: dcValue, dcValue, ref });
        break;
      }
      case 'i': {
        const dcValue = getFloat(el, 'i', 0.001);
        const ref = `I${++refCount.I}`;
        components.push({ type: 'current', x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3], value: dcValue, dcValue, ref });
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
        // Falstad uses 't' or 'pn' attribute for transistor polarity
        const tAttr = attrs.getNamedItem('t');
        const pnAttr = attrs.getNamedItem('pn');
        let tVal = 1;
        if (tAttr) {
          tVal = parseFloat(tAttr.value);
        } else if (pnAttr) {
          tVal = pnAttr.value === '1' ? 1 : -1;
        }
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
function generateRCLowpass (topology, pluginName = 'CircuitPlugin') {
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

function generateDiodeClipper (pluginName = 'CircuitPlugin') {

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

function generateMiniFuzz (pluginName = 'CircuitPlugin') {

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

/**
 * Gera código C++ para um circuito universal usando MNA.
 * Aceita qualquer topologia: filtros, pré-amps, distortion, chorus, etc.
 */
function generateUniversalMNA (netlist, params, pluginName = 'CircuitPlugin') {
  const { numNodes, elements } = netlist;

  // Identify input voltage source and output node
  const voltageSources = elements.filter(e => e.type === 'voltage' || e.type === 'sine');
  const inputSource = voltageSources.length > 0 ? voltageSources[0] : null;
  const inputNodePos = inputSource ? inputSource.node1 : 1;

  // Find output: use first node that is not ground and not input
  let outputNode = -1;
  for (const el of elements) {
    if (el.type === 'output') {
      outputNode = el.node1;
      break;
    }
  }
  // Fallback: use the node with most connections that isn't input
  if (outputNode === -1) {
    const nodeCount = new Map();
    for (const el of elements) {
      if (el.node1 !== 0 && el.node1 !== inputNodePos) nodeCount.set(el.node1, (nodeCount.get(el.node1) || 0) + 1);
      if (el.node2 !== 0 && el.node2 !== inputNodePos) nodeCount.set(el.node2, (nodeCount.get(el.node2) || 0) + 1);
    }
    let maxCount = 0;
    for (const [node, count] of nodeCount) {
      if (count > maxCount) { maxCount = count; outputNode = node; }
    }
  }
  if (outputNode === -1) outputNode = 1; // fallback

  // Count dynamic elements
  const caps = elements.filter(e => e.type === 'cap');
  const inds = elements.filter(e => e.type === 'ind');
  const diodes = elements.filter(e => e.type === 'diode');
  const transistors = elements.filter(e => e.type === 'npn' || e.type === 'pnp');

  const hasNonlinear = diodes.length > 0 || transistors.length > 0;

  // Build MNA node index mapping
  // In MNA: ground (node 0) is not in the matrix
  // Non-ground nodes get indices 0, 1, 2, ... (N-1)
  // Voltage sources get indices N, N+1, ...
  const nodeToIdx = new Map();
  let nextIdx = 0;
  for (let node = 1; node <= numNodes; node++) {
    nodeToIdx.set(node, nextIdx++);
  }
  const N = nextIdx; // number of non-ground nodes

  // MNA matrix size: N + numVoltageSources
  const M = N + voltageSources.length;

  // Helper to get MNA index for a node (ground returns -1)
  const mnaIdx = (node) => node === 0 ? -1 : (nodeToIdx.get(node) ?? -1);

  // Generate C++ code for the circuit
  const processorH = `#pragma once

#include <JuceHeader.h>
#include <cmath>
#include <cstring>

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
    static constexpr int N = ${N}; // non-ground nodes
    static constexpr int M = ${M}; // MNA matrix size
    static constexpr int NUM_CAPS = ${caps.length};
    static constexpr int NUM_INDS = ${inds.length};
    static constexpr int NUM_DIODES = ${diodes.length};
    static constexpr int NUM_TRANS = ${transistors.length};

    double sampleRate = 44100.0;
    double dt = 1.0 / 44100.0;

    // MNA matrix and RHS
    float A[M][M];
    float b[M];

    // State
    float capVoltages[NUM_CAPS];
    float indCurrents[NUM_INDS];
    float diodeVoltages[NUM_DIODES];
    float transVbe[NUM_TRANS];
    float transVbc[NUM_TRANS];

    // Node mapping
    static constexpr int nodeMap[N] = { ${Array.from(nodeToIdx.values()).join(', ')} };

    void stampMatrix (int i, int j, float val);
    void clearMatrix();
    void stampResistors();
    void stampCapacitors();
    void stampVoltageSources (float inputSample);
    bool solve();
    float diodeCurrent (float v, float Is, float n, float Vt);
    float diodeConductance (float v, float Is, float n, float Vt);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${pluginName}AudioProcessor)
};
`;

  const processorCPP = `#include "${pluginName}Processor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
${params.map(p => `    layout.add (std::make_unique<juce::AudioParameterFloat> ("${p.name}", "${p.label}",
        juce::NormalisableRange<float> (${p.min}f, ${p.max}f, 0.01f, ${p.skew}f), ${p.default}f));`).join('\n')}
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
    dt = 1.0 / rate;
    std::memset (capVoltages, 0, sizeof(capVoltages));
    std::memset (indCurrents, 0, sizeof(indCurrents));
    std::memset (diodeVoltages, 0, sizeof(diodeVoltages));
    std::memset (transVbe, 0, sizeof(transVbe));
    std::memset (transVbc, 0, sizeof(transVbc));
}

void ${pluginName}AudioProcessor::releaseResources() {}

void ${pluginName}AudioProcessor::stampMatrix (int i, int j, float val)
{
    if (i >= 0 && i < M && j >= 0 && j < M)
        A[i][j] += val;
}

void ${pluginName}AudioProcessor::clearMatrix()
{
    std::memset (A, 0, sizeof(A));
    std::memset (b, 0, sizeof(b));
}

void ${pluginName}AudioProcessor::stampResistors()
{
${elements.filter(e => e.type === 'res').map(e => {
  const i = mnaIdx(e.node1);
  const j = mnaIdx(e.node2);
  const g = (1.0 / e.value);
  const lines = [];
  lines.push(`    // ${e.ref}: ${e.value}Ω`);
  if (i >= 0) lines.push(`    stampMatrix (${i}, ${i}, ${g}f);`);
  if (j >= 0) lines.push(`    stampMatrix (${j}, ${j}, ${g}f);`);
  if (i >= 0 && j >= 0) {
    lines.push(`    stampMatrix (${i}, ${j}, -${g}f);`);
    lines.push(`    stampMatrix (${j}, ${i}, -${g}f);`);
  }
  return lines.join('\n');
}).join('\n\n')}
}

void ${pluginName}AudioProcessor::stampCapacitors()
{
${caps.map((e, idx) => {
  const i = mnaIdx(e.node1);
  const j = mnaIdx(e.node2);
  const lines = [];
  lines.push(`    // ${e.ref}: capacitor`);
  lines.push(`    {`);
  lines.push(`        float geq = (float) (${e.value} / dt);`);
  lines.push(`        float ieq = geq * capVoltages[${idx}];`);
  if (i >= 0) lines.push(`        stampMatrix (${i}, ${i}, geq);`);
  if (j >= 0) lines.push(`        stampMatrix (${j}, ${j}, geq);`);
  if (i >= 0 && j >= 0) {
    lines.push(`        stampMatrix (${i}, ${j}, -geq);`);
    lines.push(`        stampMatrix (${j}, ${i}, -geq);`);
  }
  if (i >= 0) lines.push(`        b[${i}] += ieq;`);
  if (j >= 0) lines.push(`        b[${j}] -= ieq;`);
  lines.push(`    }`);
  return lines.join('\n');
}).join('\n')}
}

void ${pluginName}AudioProcessor::stampVoltageSources (float inputSample)
{
${voltageSources.map((e, idx) => {
  const posIdx = mnaIdx(e.node1);
  const negIdx = mnaIdx(e.node2);
  const vsIdx = N + idx;
  const isInput = idx === 0;
  const lines = [];
  lines.push(`    // ${e.ref}: voltage source`);
  if (posIdx >= 0) lines.push(`    stampMatrix (${posIdx}, ${vsIdx}, 1.0f);`);
  if (negIdx >= 0) lines.push(`    stampMatrix (${negIdx}, ${vsIdx}, -1.0f);`);
  if (posIdx >= 0) lines.push(`    stampMatrix (${vsIdx}, ${posIdx}, 1.0f);`);
  if (negIdx >= 0) lines.push(`    stampMatrix (${vsIdx}, ${negIdx}, -1.0f);`);
  lines.push(`    b[${vsIdx}] += ${isInput ? 'inputSample' : `${e.dcValue || 0}f`};`);
  return lines.join('\n');
}).join('\n')}
}

float ${pluginName}AudioProcessor::diodeCurrent (float v, float Is, float n, float Vt)
{
    float nVt = n * Vt;
    if (v > 5.0f * nVt) return Is * (std::exp (5.0f) - 1.0f);
    if (v < -5.0f * nVt) return -Is;
    return Is * (std::exp (v / nVt) - 1.0f);
}

float ${pluginName}AudioProcessor::diodeConductance (float v, float Is, float n, float Vt)
{
    float nVt = n * Vt;
    if (std::abs (v) > 5.0f * nVt) return 0.001f;
    return (Is / nVt) * std::exp (v / nVt);
}

bool ${pluginName}AudioProcessor::solve()
{
    // Gaussian elimination with partial pivoting
    for (int col = 0; col < M; ++col)
    {
        // Find pivot
        int maxRow = col;
        float maxVal = std::abs (A[col][col]);
        for (int row = col + 1; row < M; ++row)
        {
            float val = std::abs (A[row][col]);
            if (val > maxVal) { maxVal = val; maxRow = row; }
        }
        if (maxVal < 1e-12f) return false; // singular

        // Swap rows
        if (maxRow != col)
        {
            for (int k = col; k < M; ++k)
                std::swap (A[col][k], A[maxRow][k]);
            std::swap (b[col], b[maxRow]);
        }

        // Eliminate
        float pivot = A[col][col];
        for (int row = col + 1; row < M; ++row)
        {
            float factor = A[row][col] / pivot;
            for (int k = col; k < M; ++k)
                A[row][k] -= factor * A[col][k];
            b[row] -= factor * b[col];
        }
    }

    // Back substitution
    for (int row = M - 1; row >= 0; --row)
    {
        float sum = b[row];
        for (int col = row + 1; col < M; ++col)
            sum -= A[row][col] * b[col]; // b[col] now holds x[col]
        b[row] = sum / A[row][row];
    }

    return true;
}

void ${pluginName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

${params.length > 0 ? `
    // Read parameters
${params.map(p => `    float ${p.name} = *apvts.getRawParameterValue ("${p.name}");`).join('\n')}
` : ''}
    for (int ch = 0; ch < totalNumInputChannels; ++ch)
    {
        auto* data = buffer.getWritePointer (ch);

        for (int s = 0; s < buffer.getNumSamples(); ++s)
        {
            float inputSample = data[s];

            // Newton-Raphson iteration for non-linear components
            for (int iter = 0; iter < ${hasNonlinear ? '10' : '1'}; ++iter)
            {
                clearMatrix();

                // Stamp linear components
                stampResistors();
                stampCapacitors();

                // Stamp voltage sources
                stampVoltageSources (inputSample);

${diodes.length > 0 ? `                // Stamp diodes (linearized)
${diodes.map((e) => {
  const i = mnaIdx(e.node1);
  const j = mnaIdx(e.node2);
  const lines = [];
  lines.push(`                // ${e.ref}`);
  lines.push(`                {`);
  lines.push(`                    float vd = b[${i}] - b[${j}];`);
  lines.push(`                    float geq = diodeConductance (vd, ${e.Is || 2.52e-9}f, ${e.n || 1.752}f, ${e.Vt || 0.02585}f);`);
  lines.push(`                    float id = diodeCurrent (vd, ${e.Is || 2.52e-9}f, ${e.n || 1.752}f, ${e.Vt || 0.02585}f);`);
  lines.push(`                    float ieq = id - geq * vd;`);
  if (i >= 0) lines.push(`                    stampMatrix (${i}, ${i}, geq);`);
  if (j >= 0) lines.push(`                    stampMatrix (${j}, ${j}, geq);`);
  if (i >= 0 && j >= 0) {
    lines.push(`                    stampMatrix (${i}, ${j}, -geq);`);
    lines.push(`                    stampMatrix (${j}, ${i}, -geq);`);
  }
  if (i >= 0) lines.push(`                    b[${i}] -= ieq;`);
  if (j >= 0) lines.push(`                    b[${j}] += ieq;`);
  lines.push(`                }`);
  return lines.join('\n');
}).join('\n')}` : ''}
${transistors.length > 0 ? `                // Stamp transistors (simplified)
${transistors.map((e) => {
  const b_idx = mnaIdx(e.node2);
  const c_idx = mnaIdx(e.node1);
  const e_idx = mnaIdx(e.node1); // simplified
  const lines = [];
  lines.push(`                // ${e.ref}`);
  lines.push(`                {`);
  lines.push(`                    float beta = 100.0f;`);
  lines.push(`                    float Ib = (b[${b_idx}] - b[${e_idx}]) / 10000.0f;`);
  lines.push(`                    float Ic = beta * Ib;`);
  if (c_idx >= 0) {
    lines.push(`                    stampMatrix (${c_idx}, ${c_idx}, 0.001f);`);
    lines.push(`                    b[${c_idx}] += Ic * ${e.polarity || 1}f;`);
  }
  lines.push(`                }`);
  return lines.join('\n');
}).join('\n')}` : ''}
                // Solve MNA system
                if (!solve()) break;

                // Update capacitor states
${caps.map((e, idx) => {
  const i = mnaIdx(e.node1);
  const j = mnaIdx(e.node2);
  if (i >= 0 && j >= 0) return `                capVoltages[${idx}] = b[${i}] - b[${j}];`;
  if (i >= 0) return `                capVoltages[${idx}] = b[${i}];`;
  if (j >= 0) return `                capVoltages[${idx}] = -b[${j}];`;
  return `                capVoltages[${idx}] = 0.0f;`;
}).join('\n')}

${diodes.length > 0 ? `                // Update diode voltages
${diodes.map((e, idx) => {
  const i = nodeList.indexOf(e.node1);
  const j = nodeList.indexOf(e.node2);
  return `                diodeVoltages[${idx}] = b[${i}] - b[${j}];`;
}).join('\n')}` : ''}
            }

            // Output: voltage at output node
            data[s] = b[${mnaIdx(outputNode)}];
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

export function generatePluginSource (topology, pluginName = 'CircuitPlugin', netlist, circuitParams) {
  let processorH, processorCPP;

  if (topology.type === 'rc_lowpass') {
    const gen = generateRCLowpass(topology, pluginName);
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else if (topology.type === 'diode_clipper') {
    const gen = generateDiodeClipper(pluginName);
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else if (topology.type === 'mini_fuzz') {
    const gen = generateMiniFuzz(pluginName);
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else if (netlist) {
    // Universal MNA fallback: any topology
    const gen = generateUniversalMNA(netlist, circuitParams || [], pluginName);
    processorH = gen.processorH;
    processorCPP = gen.processorCPP;
  } else {
    const gen = generateRCLowpass({ type: 'rc_lowpass', params: { cutoffHz: 1000 } }, pluginName);
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
${useWDF ? `target_link_libraries(${pluginName} PRIVATE chowdsp::chowdsp_wdf)` : ''}
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
export function generatePlugin (xmlString, pluginName = 'CircuitPlugin', customDOMParser) {
  const circuit = parseFalstadXml(xmlString, customDOMParser);
  const topology = detectTopology(circuit);

  // Build netlist for universal MNA
  let netlist = null;
  let circuitParams = [];
  try {
    netlist = buildNetlist(circuit);
    circuitParams = analyzeParameters(netlist.elements);
  } catch {
    // buildNetlist may fail if circuit is malformed
  }

  const sources = generatePluginSource(topology, pluginName, netlist, circuitParams);
  return { sources, topology, circuit, pluginName, netlist };
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
