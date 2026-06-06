export interface Person {
  readonly name: string;
  readonly role?: string;
  readonly context: string;
}

export interface Company {
  readonly name: string;
  readonly context: string;
}

export interface Location {
  readonly name: string;
  readonly context: string;
}

export interface Topic {
  readonly name: string;
  readonly summary: string;
  readonly keyPoints: readonly string[];
}

export interface Fact {
  readonly content: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly relatedEntities: readonly string[];
}

export interface TimelineEntry {
  readonly date: string;
  readonly event: string;
  readonly participants: readonly string[];
}

export interface Sentiment {
  readonly overall: 'positive' | 'negative' | 'neutral';
  readonly score: number;
  readonly notes: string;
}

export interface ExtractedMemories {
  readonly entities: {
    readonly people: readonly Person[];
    readonly companies: readonly Company[];
    readonly locations: readonly Location[];
  };
  readonly topics: readonly Topic[];
  readonly facts: readonly Fact[];
  readonly sentiment: Sentiment;
  readonly timeline: readonly TimelineEntry[];
}
