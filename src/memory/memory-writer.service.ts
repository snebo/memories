import { Injectable, Logger } from '@nestjs/common';
import {
  Company,
  ExtractedMemories,
  Location,
  Person,
  TimelineEntry,
  Topic,
} from './types/extracted-memories.types';
import { StorageService } from './storage.service';

@Injectable()
export class MemoryWriterService {
  private readonly logger = new Logger(MemoryWriterService.name);

  constructor(private readonly storage: StorageService) {}

  toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/'/g, ' ')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  buildPersonContent(
    existing: string | null,
    person: Person,
    date: string,
  ): string {
    if (!existing) {
      return [
        `# ${person.name}`,
        '',
        person.role ? `**Role**: ${person.role}` : '',
        '',
        '## Updates',
        '',
        `### ${date}`,
        `- ${person.context}`,
        '',
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n');
    }
    return this.appendUpdateBlock(existing, date, [person.context]);
  }

  buildTopicContent(
    existing: string | null,
    topic: Topic,
    date: string,
  ): string {
    if (!existing) {
      const keyPointLines = topic.keyPoints.map((p) => `- ${p}`).join('\n');
      return [
        `# ${topic.name}`,
        '',
        '## Updates',
        '',
        `### ${date}`,
        `**Summary**: ${topic.summary}`,
        '',
        '**Key Points**:',
        keyPointLines,
        '',
      ].join('\n');
    }
    const lines = [
      `**Summary**: ${topic.summary}`,
      '',
      '**Key Points**:',
      ...topic.keyPoints.map((p) => `- ${p}`),
    ];
    return this.appendUpdateBlock(existing, date, lines);
  }

  buildEntityContent(
    existing: string | null,
    entity: Company | Location,
    date: string,
  ): string {
    if (!existing) {
      return [
        `# ${entity.name}`,
        '',
        '## Updates',
        '',
        `### ${date}`,
        `- ${entity.context}`,
        '',
      ].join('\n');
    }
    return this.appendUpdateBlock(existing, date, [entity.context]);
  }

  buildTimelineContent(existing: string | null, entry: TimelineEntry): string {
    const period = this.timelinePeriod(entry.date);
    const participants =
      entry.participants.length > 0
        ? ` (${entry.participants.join(', ')})`
        : '';
    const eventLine = `- ${entry.date}: ${entry.event}${participants}`;

    if (!existing) {
      return [`# ${period}`, '', '## Events', '', eventLine, ''].join('\n');
    }
    if (existing.includes(eventLine)) return existing;
    return existing.trimEnd() + '\n' + eventLine + '\n';
  }

  async writeMemories(
    memories: ExtractedMemories,
    date: string,
  ): Promise<void> {
    const writes: Array<Promise<void>> = [];

    for (const person of memories.entities.people) {
      writes.push(
        this.mergeAndWrite(`people/${this.toSlug(person.name)}.md`, (e) =>
          this.buildPersonContent(e, person, date),
        ),
      );
    }
    for (const company of memories.entities.companies) {
      writes.push(
        this.mergeAndWrite(
          `entities/companies/${this.toSlug(company.name)}.md`,
          (e) => this.buildEntityContent(e, company, date),
        ),
      );
    }
    for (const location of memories.entities.locations) {
      writes.push(
        this.mergeAndWrite(
          `entities/locations/${this.toSlug(location.name)}.md`,
          (e) => this.buildEntityContent(e, location, date),
        ),
      );
    }
    for (const topic of memories.topics) {
      writes.push(
        this.mergeAndWrite(`topics/${this.toSlug(topic.name)}.md`, (e) =>
          this.buildTopicContent(e, topic, date),
        ),
      );
    }
    for (const entry of memories.timeline) {
      const period = this.timelinePeriod(entry.date);
      writes.push(
        this.mergeAndWrite(`timeline/${period}/summary.md`, (e) =>
          this.buildTimelineContent(e, entry),
        ),
      );
    }

    await Promise.all(writes);
    this.logger.log(`Wrote ${writes.length} memory files for date ${date}`);
  }

  private async mergeAndWrite(
    key: string,
    build: (existing: string | null) => string,
  ): Promise<void> {
    const existing = await this.storage.readFile(key);
    const content = build(existing);
    await this.storage.writeFile(key, content);
  }

  private appendUpdateBlock(
    existing: string,
    date: string,
    lines: string[],
  ): string {
    if (existing.includes(`### ${date}`)) return existing;
    const block = [`### ${date}`, ...lines, ''].join('\n');
    return existing.trimEnd() + '\n\n' + block;
  }

  private timelinePeriod(date: string): string {
    // "2026-06-15" → "2026-06", "2026-Q3" → "2026-Q3", "2026-06" → "2026-06"
    const isoMonth = /^(\d{4}-\d{2})-\d{2}$/.exec(date);
    return isoMonth ? isoMonth[1] : date;
  }
}
