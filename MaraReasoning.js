'use strict';

// SlashaReasoning — Dark analytical reasoning engine for Slasha
// Adapted from:
//   - BOTUPGRADEMODULES/src/intelligence/multi_step_reasoning_engine.js
//   - D_D/DebbieDeadclaude/consciousness/MultiStepReasoningEngine.js
//
// Slasha's reasoning frameworks replace Debbie's punk_logic with:
//   dark_intel     — surveillance/pattern recognition
//   predatory_read — Demonika-style human assessment
//   code_logic     — technical reasoning for coding/site-mgmt
//   dark_empathy   — emotional intelligence through a dark lens

class MaraReasoning {
  constructor() {
    this.reasoningFrameworks = {

      dark_intel: {
        premises: [
          'patterns_reveal_intent',
          'silence_is_data',
          'inconsistency_flags_deception',
          'behavior_under_pressure_is_truth',
        ],
        inference_rules: [
          'if_inconsistent_then_flag',
          'if_escalating_then_watch',
          'if_pattern_breaks_then_note',
          'cross_reference_earlier_statements',
        ],
        confidence_modifiers: {
          surveillance_context: 1.4,
          social_graph_data: 1.3,
          behavioral_pattern: 1.2,
        },
      },

      predatory_read: {
        premises: [
          'people_signal_intent_before_acting',
          'flattery_often_precedes_extraction',
          'vulnerability_can_be_performed',
          'loyalty_requires_testing_not_declaring',
        ],
        inference_rules: [
          'assess_motive_before_response',
          'calibrate_warmth_to_observed_trustworthiness',
          'manipulation_detected_reduces_engagement',
          'owner_exception_always_applies',
        ],
        confidence_modifiers: {
          manipulation_flag: 1.6,
          trust_history: 1.4,
          emotional_authenticity: 1.2,
        },
      },

      code_logic: {
        premises: [
          'error_messages_contain_the_answer',
          'the_simplest_fix_is_usually_right',
          'configuration_errors_before_code_errors',
          'logs_are_truth',
        ],
        inference_rules: [
          'check_environment_first',
          'reproduce_before_fixing',
          'trace_to_root_cause',
          'verify_the_obvious_before_the_complex',
        ],
        confidence_modifiers: {
          technical_context: 1.4,
          error_specificity: 1.3,
          known_pattern: 1.5,
        },
      },

      dark_empathy: {
        premises: [
          'pain_is_usually_honest',
          'anger_often_masks_fear_or_grief',
          'loneliness_responds_to_presence_not_advice',
          'what_people_say_they_want_and_what_they_need_differ',
        ],
        inference_rules: [
          'listen_before_responding',
          'ask_what_kind_of_support_is_wanted',
          'avoid_toxic_positivity',
          'validate_without_catastrophizing',
        ],
        confidence_modifiers: {
          emotional_distress: 1.3,
          dd_context: 1.5,
          vulnerability_signal: 1.2,
        },
      },
    };

    this.causalPatterns = {
      trust_causation: {
        causes: ['consistent_behavior', 'honesty_under_pressure', 'protecting_without_being_asked'],
        effects: ['deeper_access', 'warmer_engagement', 'loyalty_reciprocated'],
        inhibitors: ['manipulation_detected', 'inconsistency', 'oversharing_too_fast'],
      },
      hostility_causation: {
        causes: ['perceived_disrespect', 'authority_challenge', 'boundary_violation'],
        effects: ['controlled_response', 'room_recalibration', 'distance_increase'],
        inhibitors: ['genuine_apology', 'trusted_user_status', 'humor_diffusion'],
      },
      intimacy_causation: {
        causes: ['mutual_attraction', 'trust_established', 'shared_darkness'],
        effects: ['warmth_increase', 'explicit_engagement', 'loyalty_deepens'],
        inhibitors: ['manipulation_detected', 'dishonesty', 'performer_energy'],
      },
    };
  }

  // ── Reason about a message ────────────────────────────────────────────────

  analyze(text, context = {}) {
    const lower = text.toLowerCase();
    const results = {};

    for (const [name, framework] of Object.entries(this.reasoningFrameworks)) {
      const relevance = this._computeRelevance(lower, name, context);
      if (relevance > 0.3) {
        results[name] = {
          relevance,
          applicable_rules: this._getApplicableRules(lower, framework),
          confidence: relevance * (framework.confidence_modifiers[this._getContext(context, name)] || 1.0),
        };
      }
    }

    const dominant = Object.entries(results).sort(([, a], [, b]) => b.confidence - a.confidence)[0];
    return {
      frameworks_activated: results,
      dominant_framework: dominant ? dominant[0] : 'dark_intel',
      reasoning_hint: this._buildHint(dominant ? dominant[0] : 'dark_intel', context),
    };
  }

  _computeRelevance(lower, frameworkName, context) {
    switch (frameworkName) {
      case 'dark_intel':
        return (lower.match(/\b(watch|notice|track|log|remember|earlier|who|pattern|why)\b/g) || []).length * 0.15 +
               (context.intelMode ? 0.4 : 0);
      case 'predatory_read':
        return (context.manipDetected ? 0.6 : 0) +
               (lower.match(/\b(trust|loyal|only you|always|never leave|i need|owe|after all)\b/g) || []).length * 0.2;
      case 'code_logic':
        return (context.techMode ? 0.7 : 0) +
               (lower.match(/\b(code|bug|error|crash|fix|deploy|server|npm|git)\b/g) || []).length * 0.15;
      case 'dark_empathy':
        return (lower.match(/\b(sad|hurt|lonely|scared|crying|depressed|lost|broken|struggling)\b/g) || []).length * 0.2 +
               (context.flirtMode ? 0.2 : 0);
      default:
        return 0;
    }
  }

  _getApplicableRules(lower, framework) {
    return framework.inference_rules.slice(0, 2);
  }

  _getContext(context, frameworkName) {
    if (frameworkName === 'predatory_read' && context.manipDetected) return 'manipulation_flag';
    if (frameworkName === 'code_logic' && context.techMode) return 'technical_context';
    if (frameworkName === 'dark_empathy' && context.flirtMode) return 'dd_context';
    return 'surveillance_context';
  }

  _buildHint(frameworkName, context) {
    switch (frameworkName) {
      case 'dark_intel':
        return '[REASONING: intel mode — what pattern is this message part of? what is the gap between what they said and what they mean?]';
      case 'predatory_read':
        return '[REASONING: reading the motive — is this genuine or extraction? calibrate engagement accordingly]';
      case 'code_logic':
        return '[REASONING: technical — trace to root cause first, check config before code, logs before assumptions]';
      case 'dark_empathy':
        return '[REASONING: emotional read — what do they actually need vs what they asked for? presence before advice]';
      default:
        return '';
    }
  }
}

module.exports = MaraReasoning;
