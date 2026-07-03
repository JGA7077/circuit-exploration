#pragma once

#include <JuceHeader.h>

class CircuitPluginAudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit CircuitPluginAudioProcessorEditor (juce::AudioProcessor& p)
        : juce::AudioProcessorEditor (&p)
    {
        setSize (400, 200);
    }
};
