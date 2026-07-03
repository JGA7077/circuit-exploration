#pragma once

#include <JuceHeader.h>
#include <vector>

class CircuitPluginAudioProcessor : public juce::AudioProcessor
{
public:
    CircuitPluginAudioProcessor();
    ~CircuitPluginAudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return false; }

    const juce::String getName() const override { return "CircuitPlugin"; }

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
    std::vector<float> z1; // 1-pole filter state per channel
    float b0 = 0.0f;       // feed-forward coeff
    float a1 = 0.0f;       // feedback coeff

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CircuitPluginAudioProcessor)
};
