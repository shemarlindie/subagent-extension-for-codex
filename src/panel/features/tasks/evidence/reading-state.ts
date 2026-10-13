type ReadingPosition = {
  top: number;
  pinned: boolean;
  anchor?: { id: string; top: number };
};

export type ReadingState = { position?: ReadingPosition };
