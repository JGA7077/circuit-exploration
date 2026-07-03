#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"

class MiniFuzzAudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit MiniFuzzAudioProcessorEditor (MiniFuzzAudioProcessor&);
    ~MiniFuzzAudioProcessorEditor() override = default;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    MiniFuzzAudioProcessor& processorRef;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MiniFuzzAudioProcessorEditor)
};
