#include "PluginProcessor.h"

static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    layout.add (std::make_unique<juce::AudioParameterFloat> ("drive", "Drive",
        juce::NormalisableRange<float> (0.0f, 24.0f, 0.1f), 12.0f));
    layout.add (std::make_unique<juce::AudioParameterFloat> ("output", "Output",
        juce::NormalisableRange<float> (-24.0f, 24.0f, 0.1f), 0.0f));
    return layout;
}

MiniFuzzAudioProcessor::MiniFuzzAudioProcessor()
    : AudioProcessor (BusesProperties().withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                                       .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

void MiniFuzzAudioProcessor::prepareToPlay (double rate, int)
{
    sampleRate = rate;
    for (auto& c : circuit)
        c.prepare (rate);
}

void MiniFuzzAudioProcessor::releaseResources()
{
    for (auto& c : circuit)
        c.reset();
}

void MiniFuzzAudioProcessor::FuzzCircuit::prepare (double fs)
{
    C1.prepare ((float) fs);
}

void MiniFuzzAudioProcessor::FuzzCircuit::reset()
{
    C1.reset();
}

float MiniFuzzAudioProcessor::FuzzCircuit::processSample (float x)
{
    // Pre-saturation (BC517 Darlington stage)
    float v = std::tanh (x * 2.0f);

    Vs.setVoltage ((double) v);
    dp.incident (P2.reflected());
    auto y = wdft::voltage<float> (Rload);
    P2.incident (dp.reflected());
    return y;
}

void MiniFuzzAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
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

juce::AudioProcessorEditor* MiniFuzzAudioProcessor::createEditor()
{
    return nullptr;
}

void MiniFuzzAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::MemoryOutputStream mos (destData, false);
    apvts.state.writeToStream (mos);
}

void MiniFuzzAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto tree = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);
    if (tree.isValid())
        apvts.replaceState (tree);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new MiniFuzzAudioProcessor();
}
