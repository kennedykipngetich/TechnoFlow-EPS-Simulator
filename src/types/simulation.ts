export type MachineState = 'CONFIGURING' | 'IDLE' | 'RUNNING' | 'PAUSED' | 'EMERGENCY_STOP';

export type ZoneStatus = 'IDLE' | 'POSITIONING' | 'READY' | 'BUSY' | 'ERROR';

export type BlockProcessStep = 
  | 'WAITING'
  | 'Z1_LOADING'
  | 'Z1_POSITIONING'
  | 'Z1_MEASURING'
  | 'Z1_HYDRAULIC_FALL'
  | 'Z1_HORIZ_CUT'
  | 'Z2_TRANSIT'
  | 'Z2_VERT_CUT'
  | 'Z3_TRANSIT'
  | 'Z3_SLICING'
  | 'Z3_DISCHARGING'
  | 'COMPLETED';

export interface Block {
  id: string;
  step: BlockProcessStep;
  progress: number; // 0-100 within a step
  startTime: number;
  zone3StartTime?: number;
}

export interface SimulationParams {
  masterSpeed: number; // 1-10
  optimizerActive: boolean;
  scrapCollectionActive: boolean;
  z1Wires: number;
  z2Wires: number;
  blockSize: string;
  density: number;
  orderSize: number;
  temperature: number;
  speedOverride: number;
}

export interface ScrapState {
  currentVolume: number; // 0-100% capacity before crushing
  crusherActive: boolean;
  fanSpeed: number; // 0-100%
  totalRecycled: number;
}
