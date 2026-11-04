// @3d-dice/dice-box ships without types; just what we use.
declare module "@3d-dice/dice-box" {
  export interface DieResult { sides: number; value: number; groupId: number; rollId: number }
  export default class DiceBox {
    constructor(config: { container: string; assetPath: string; theme?: string; themeColor?: string; scale?: number; offscreen?: boolean; gravity?: number });
    init(): Promise<unknown>;
    roll(notation: string | string[]): Promise<DieResult[]>; // every die, tagged with its notation's groupId
    clear(): void;
  }
}
