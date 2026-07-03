#pragma once

#include <JuceHeader.h>
#include <chowdsp_wdf/chowdsp_wdf.h>

namespace wdft = chowdsp::wdft;

class MiniFuzzAudioProcessor : public juce::AudioProcessor
{
public:
    MiniFuzzAudioProcessor();
    ~MiniFuzzAudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return false; }

    const juce::String getName() const override { return "MiniFuzz"; }

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

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MiniFuzzAudioProcessor)
};
