#include "PluginEditor.h"

MiniFuzzAudioProcessorEditor::MiniFuzzAudioProcessorEditor (MiniFuzzAudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    setSize (400, 200);
}

void MiniFuzzAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colours::black);
    g.setColour (juce::Colours::white);
    g.setFont (15.0f);
    g.drawFittedText ("MiniFuzz", getLocalBounds(), juce::Justification::centred, 1);
}

void MiniFuzzAudioProcessorEditor::resized()
{
}
