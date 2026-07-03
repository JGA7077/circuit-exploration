#include "PluginProcessor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("cutoff", "Cutoff (Hz)",
        juce::NormalisableRange<float> (20.0f, 20000.0f, 1.0f, 0.3f), 1000.0f));

    return layout;
}

CircuitPluginAudioProcessor::CircuitPluginAudioProcessor()
    : AudioProcessor (BusesProperties().withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                                       .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

void CircuitPluginAudioProcessor::prepareToPlay (double rate, int)
{
    sampleRate = rate;
    auto numChannels = getTotalNumInputChannels();
    z1.assign (numChannels, 0.0f);
    updateCoefficients (rate);
}

void CircuitPluginAudioProcessor::releaseResources()
{
    z1.clear();
}

void CircuitPluginAudioProcessor::updateCoefficients (double fs)
{
    float fc = *apvts.getRawParameterValue ("cutoff");
    if (fc < 1.0f) fc = 1.0f;
    if (fc >= (float)fs * 0.49f) fc = (float)fs * 0.49f;

    // 1-pole RC low-pass: a = 1 - exp(-2*pi*fc/fs)
    // y[n] = a * x[n] + (1-a) * y[n-1]
    // => b0 = a, a1 = 1-a
    float a = 1.0f - std::exp (-2.0f * juce::MathConstants<float>::pi * fc / (float)fs);
    b0 = a;
    a1 = 1.0f - a;
}

void CircuitPluginAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
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

juce::AudioProcessorEditor* CircuitPluginAudioProcessor::createEditor()
{
    return nullptr; // sem UI por enquanto
}

void CircuitPluginAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::MemoryOutputStream mos (destData, false);
    apvts.state.writeToStream (mos);
}

void CircuitPluginAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto tree = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);
    if (tree.isValid())
        apvts.replaceState (tree);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CircuitPluginAudioProcessor();
}
