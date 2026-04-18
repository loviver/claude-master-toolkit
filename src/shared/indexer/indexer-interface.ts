import type { IndexedSymbol } from './ts-indexer.js';

export interface LanguageIndexer {
  canHandle(file: string): boolean;
  extractFromFile(
    projectPath: string,
    absPath: string,
    content: string,
  ): IndexedSymbol[];
}

export type { IndexedSymbol };
