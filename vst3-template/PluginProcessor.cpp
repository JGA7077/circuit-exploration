#include "PluginProcessor.h"

namespace wdft = chowdsp::wdft;

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("drive", "Drive (dB)",
        juce::NormalisableRange<float> (0.0f, 30.0f, 0.1f), 0.0f));
    layout.add (std::make_unique<juce::AudioParameterFloat> ("output", "Output (dB)",
        juce::NormalisableRange<float> (-30.0f, 6.0f, 0.1f), 0.0f));
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
    for (auto& c : clipper)
        c.prepare (rate);
}

void CircuitPluginAudioProcessor::releaseResources()
{
    for (auto& c : clipper)
        c.reset();
}

void CircuitPluginAudioProcessor::DiodeClipper::prepare (double fs)
{
    C1.prepare ((float) fs);
}

void CircuitPluginAudioProcessor::DiodeClipper::reset()
{
    C1.reset();
}

float CircuitPluginAudioProcessor::DiodeClipper::processSample (float x)
{
    Vs.setVoltage (x);
    dp.incident (P1.reflected());
    auto y = wdft::voltage<float> (C1);
    P1.incident (dp.reflected());
    return y;
}

void CircuitPluginAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
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
            x = clipper[ch].processSample (x);
            data[s] = x * outGain;
        }
    }
}

juce::AudioProcessorEditor* CircuitPluginAudioProcessor::createEditor()
{
    return nullptr;
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
