/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Pause, 
  Square, 
  Activity, 
  Settings, 
  Zap, 
  Gauge, 
  Layers, 
  Maximize2,
  RefreshCcw,
  AlertCircle,
  CheckCircle2,
  Info,
  Wind,
  Trash2,
  Fan,
  Download,
  Save,
  Thermometer,
  Cpu,
  MoreVertical
} from 'lucide-react';
import { cn } from './lib/utils';
import { MachineState, Block, BlockProcessStep, SimulationParams, ScrapState, ZoneStatus } from './types/simulation';

const STEP_ORDER: BlockProcessStep[] = [
  'Z1_LOADING',
  'Z1_POSITIONING',
  'Z1_MEASURING',
  'Z1_HYDRAULIC_FALL',
  'Z1_HORIZ_CUT',
  'Z2_TRANSIT',
  'Z2_VERT_CUT',
  'Z3_TRANSIT',
  'Z3_SLICING',
  'Z3_DISCHARGING',
];

const STEP_DURATIONS: Record<BlockProcessStep, number> = {
  'WAITING': 0,
  'Z1_LOADING': 2000,
  'Z1_POSITIONING': 1500,
  'Z1_MEASURING': 1000,
  'Z1_HYDRAULIC_FALL': 800,
  'Z1_HORIZ_CUT': 2500,
  'Z2_TRANSIT': 2000,
  'Z2_VERT_CUT': 3000,
  'Z3_TRANSIT': 2000,
  'Z3_SLICING': 2500,
  'Z3_DISCHARGING': 1500,
  'COMPLETED': 0,
};

export default function App() {
  const [machineState, setMachineState] = useState<MachineState>('CONFIGURING');
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  const [params, setParams] = useState<SimulationParams>({
    masterSpeed: 5,
    optimizerActive: false,
    scrapCollectionActive: true,
    z1Wires: 10,
    z2Wires: 15,
    blockSize: '4000x1200x1000',
    density: 15,
    orderSize: 50,
    temperature: 24,
    speedOverride: 1.0,
  });

  const [zoneStatuses, setZoneStatuses] = useState<Record<string, ZoneStatus>>({
    Z1: 'IDLE',
    Z2: 'IDLE',
    Z3: 'READY',
  });

  const [wirePositioning, setWirePositioning] = useState<{ zone: string, wireIndex: number } | null>(null);
  const [menuConfig, setMenuConfig] = useState<{ x: number, y: number } | null>(null);

  const [scrapState, setScrapState] = useState<ScrapState>({
    currentVolume: 0,
    crusherActive: false,
    fanSpeed: 0,
    totalRecycled: 0,
  });

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [efficiency, setEfficiency] = useState(85);
  const [logs, setLogs] = useState<{ id: string, message: string, type: 'info' | 'error' }[]>([]);
  const lastUpdateRef = useRef<number>(Date.now());

  // Automatic reset to IDLE when order is done
  useEffect(() => {
    if (completedCount >= params.orderSize && machineState === 'RUNNING' && blocks.length === 0) {
      setMachineState('IDLE');
      setZoneStatuses({ Z1: 'IDLE', Z2: 'IDLE', Z3: 'READY' });
      setLogs(prev => [...prev.slice(-10), { 
        id: Math.random().toString(), 
        message: `Order of ${params.orderSize} blocks completed. System transitioning to IDLE.`,
        type: 'info' 
      }]);
    }
  }, [completedCount, params.orderSize, machineState, blocks.length]);

  // Simulation loop
  useEffect(() => {
    if (machineState !== 'RUNNING') {
      lastUpdateRef.current = Date.now();
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastUpdateRef.current) * (params.masterSpeed / 5) * params.speedOverride;
      lastUpdateRef.current = now;

      let shouldTriggerZ3Error = false;
      let errorBlockId = '';

      setBlocks(prevBlocks => {
        let nextBlocks = prevBlocks.map(block => {
          const duration = STEP_DURATIONS[block.step];
          const increment = (delta / duration) * 100;
          let nextProgress = block.progress + increment;

          // Check for Zone 3 timeout (reasonable time = 30 seconds)
          if (block.step.startsWith('Z3_') && block.zone3StartTime && Date.now() - block.zone3StartTime > 30000) { 
             shouldTriggerZ3Error = true;
             errorBlockId = block.id;
          }

          if (nextProgress >= 100) {
            const nextStepIndex = STEP_ORDER.indexOf(block.step) + 1;
            if (nextStepIndex < STEP_ORDER.length) {
              const nextStep = STEP_ORDER[nextStepIndex];
              
              // Handoff safety checks
              if (nextStep === 'Z2_TRANSIT' && zoneStatuses.Z2 !== 'READY') return { ...block, progress: 99 };
              if (nextStep === 'Z3_TRANSIT' && zoneStatuses.Z3 !== 'READY') return { ...block, progress: 99 };
              if (zoneStatuses.Z3 === 'ERROR') return { ...block, progress: 99 };

              // Track when block enters Zone 3
              const zone3StartTime = nextStep === 'Z3_TRANSIT' ? Date.now() : block.zone3StartTime;

              return {
                ...block,
                step: nextStep,
                progress: 0,
                zone3StartTime,
              };
            } else {
              setCompletedCount(c => c + 1);
              return { ...block, step: 'COMPLETED' as const, progress: 100 };
            }
          }
          return { ...block, progress: nextProgress };
        });

        // Filter out completed blocks and spawn new one if z1 is free and ready
        nextBlocks = nextBlocks.filter(b => b.step !== 'COMPLETED');
        
        const isZ1Busy = nextBlocks.some(b => b.step.startsWith('Z1_'));
        if (!isZ1Busy && nextBlocks.length < 3 && completedCount < params.orderSize && zoneStatuses.Z1 === 'READY') {
          nextBlocks.push({
            id: Math.random().toString(36).substr(2, 9),
            step: 'Z1_LOADING',
            progress: 0,
            startTime: Date.now(),
          });
        }

        return nextBlocks;
      });

      if (shouldTriggerZ3Error) {
        setZoneStatuses(prev => ({ ...prev, Z3: 'ERROR' }));
        setLogs(prev => {
          if (prev.some(l => l.message.includes(errorBlockId))) return prev;
          return [...prev, { 
            id: Math.random().toString(), 
            message: `CRITICAL: Block ${errorBlockId} stuck in Zone 3 - check discharge line`, 
            type: 'error' 
          }];
        });
      }

      // Fluctuate efficiency slightly
      setEfficiency(prev => {
        const target = params.optimizerActive ? 98 : 88;
        const drift = (Math.random() - 0.5) * 0.5;
        return Math.min(100, Math.max(70, prev + (target - prev) * 0.1 + drift));
      });

      // Scrap logic
      setScrapState(prev => {
        const isCutting = blocks.some(b => b.step.includes('CUT') || b.step.includes('SLICING'));
        const generationRate = isCutting ? 0.2 * (params.masterSpeed / 5) : 0;
        let newVolume = prev.currentVolume + generationRate;
        
        const crusherCapacity = 0.5 * (params.masterSpeed / 5);
        const shouldCrush = newVolume > 5;
        const processed = shouldCrush ? Math.min(newVolume, crusherCapacity) : 0;
        
        newVolume -= processed;
        
        return {
          ...prev,
          currentVolume: Math.min(100, Math.max(0, newVolume)),
          crusherActive: shouldCrush && machineState === 'RUNNING',
          fanSpeed: shouldCrush ? 80 + Math.random() * 20 : 0,
          totalRecycled: prev.totalRecycled + processed,
        };
      });

    }, 50);

    return () => clearInterval(interval);
  }, [machineState, params.masterSpeed, params.optimizerActive, params.orderSize, params.speedOverride, completedCount, zoneStatuses]);

  // Wire positioning automation
  useEffect(() => {
    if (!wirePositioning) return;

    const totalWires = wirePositioning.zone === 'Z1' ? params.z1Wires : params.z2Wires;
    
    // Hardware validation and completion logic
    if (wirePositioning.wireIndex >= totalWires) {
      const HARDWARE_CAPACITY_LIMIT = 40;
      
      if (totalWires > HARDWARE_CAPACITY_LIMIT) {
        setZoneStatuses(prev => ({ ...prev, [wirePositioning.zone]: 'ERROR' }));
        setLogs(prev => [...prev, { 
          id: Math.random().toString(), 
          message: `WARNING: Zone ${wirePositioning.zone} wire configuration (${totalWires}) exceeds the physical capacity limit of ${HARDWARE_CAPACITY_LIMIT}. Calibration failed.`, 
          type: 'error' 
        }]);
      } else {
        setZoneStatuses(prev => ({ ...prev, [wirePositioning.zone]: 'READY' }));
      }
      
      setWirePositioning(null);
      return;
    }

    const timer = setTimeout(() => {
      setWirePositioning(prev => prev ? { ...prev, wireIndex: prev.wireIndex + 1 } : null);
    }, 3000);

    return () => clearTimeout(timer);
  }, [wirePositioning, params.z1Wires, params.z2Wires]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (machineState === 'CONFIGURING') return;
    setMenuConfig({ x: e.clientX, y: e.clientY });
  };

  const startWirePositioning = () => {
    setZoneStatuses(prev => ({ ...prev, Z1: 'POSITIONING', Z2: 'POSITIONING' }));
    setWirePositioning({ zone: 'Z1', wireIndex: 0 });
    // This will start Z1, then we'd need a separate effect or chaining to start Z2 after Z1 finishes
    // For simplicity, let's start both at some interval or sequentially
    // Let's make it sequential: Z1 then Z2
  };

  // Improved wire positioning logic to handle sequential zones
  useEffect(() => {
    if (zoneStatuses.Z1 === 'READY' && zoneStatuses.Z2 === 'POSITIONING' && !wirePositioning) {
      setWirePositioning({ zone: 'Z2', wireIndex: 0 });
    }
  }, [zoneStatuses.Z1, zoneStatuses.Z2, wirePositioning]);

  const toggleMachine = () => {
    if (machineState === 'IDLE' && zoneStatuses.Z1 === 'READY' && zoneStatuses.Z2 === 'READY') {
      setMachineState('RUNNING');
    } else {
      setMachineState(prev => prev === 'RUNNING' ? 'PAUSED' : 'RUNNING');
    }
  };

  const emergencyStop = () => {
    setMachineState('EMERGENCY_STOP');
    setBlocks([]);
    setWirePositioning(null);
  };

  const resetMachine = () => {
    setMachineState('IDLE');
    setBlocks([]);
    setCompletedCount(0);
    setEfficiency(85);
    setZoneStatuses({ Z1: 'IDLE', Z2: 'IDLE', Z3: 'READY' });
    setWirePositioning(null);
  };

  const updateMasterSpeed = (newSpeed: number) => {
    setParams(p => ({
      ...p,
      masterSpeed: newSpeed,
    }));
  };

  const finalizeConfig = () => {
    setMachineState('IDLE');
  };

  return (
    <div 
      className="min-h-screen bg-slate-950 p-4 lg:p-8 flex flex-col gap-6 selection:bg-indigo-500/30 relative"
      onContextMenu={handleContextMenu}
      onClick={() => setMenuConfig(null)}
    >
      {/* Absolute Settings Button */}
      <button 
        onClick={() => setMachineState('CONFIGURING')}
        className="fixed top-[30px] right-[25px] z-[90] p-3 bg-slate-900/80 backdrop-blur-sm border border-slate-700 rounded-full text-slate-300 hover:text-white hover:bg-slate-800 transition-all shadow-xl group"
        title="Configuration Interface"
      >
        <Settings size={20} className="group-hover:rotate-90 transition-transform duration-500" />
      </button>

      {/* Context Menu */}
      <AnimatePresence>
        {menuConfig && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{ top: menuConfig.y, left: menuConfig.x }}
            className="fixed z-50 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg py-2 min-w-[200px]"
          >
            <button 
              onClick={startWirePositioning}
              className="w-full text-left px-4 py-2 hover:bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2"
            >
              <Cpu size={14} className="text-indigo-400" />
              Wire Positioning
            </button>
            <button 
              onClick={resetMachine}
              className="w-full text-left px-4 py-2 hover:bg-slate-800 text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2"
            >
              <RefreshCcw size={14} className="text-emerald-400" />
              Full Reset
            </button>
            <div className="h-px bg-slate-800 my-1" />
            <button 
              onClick={emergencyStop}
              className="w-full text-left px-4 py-2 hover:bg-slate-800 text-xs font-bold text-red-500 uppercase tracking-widest flex items-center gap-2"
            >
              <Square size={14} fill="currentColor" />
              Emergency Stop
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup Overlay */}
      <AnimatePresence>
        {machineState === 'CONFIGURING' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
            >
              <div className="bg-indigo-600 p-8 text-white">
                <div className="flex items-center gap-3 mb-2">
                  <Settings className="w-8 h-8" />
                  <h2 className="text-2xl font-bold tracking-tight uppercase">Line Configuration</h2>
                </div>
                <p className="text-indigo-100 text-sm italic">Set operational parameters before launching the line.</p>
              </div>

              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Zone 1 Cut Wires</label>
                    <input 
                      type="number" 
                      value={params.z1Wires}
                      onChange={(e) => setParams(p => ({ ...p, z1Wires: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Zone 2 Cut Wires</label>
                    <input 
                      type="number" 
                      value={params.z2Wires}
                      onChange={(e) => setParams(p => ({ ...p, z2Wires: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Block Target (Order Size)</label>
                    <input 
                      type="number" 
                      value={params.orderSize}
                      onChange={(e) => setParams(p => ({ ...p, orderSize: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Block Dimensions (L x W x H)</label>
                    <input 
                      type="text" 
                      value={params.blockSize}
                      onChange={(e) => setParams(p => ({ ...p, blockSize: e.target.value }))}
                      placeholder="e.g. 4000x1200x1000"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Density (kg/m³)</label>
                      <input 
                        type="number" 
                        value={params.density}
                        onChange={(e) => setParams(p => ({ ...p, density: parseInt(e.target.value) || 0 }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Temp (°C)</label>
                      <input 
                        type="number" 
                        value={params.temperature}
                        onChange={(e) => setParams(p => ({ ...p, temperature: parseInt(e.target.value) || 0 }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Master Speed Override</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={params.speedOverride}
                      onChange={(e) => setParams(p => ({ ...p, speedOverride: parseFloat(e.target.value) || 1.0 }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm text-white focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-slate-800 flex gap-4">
                <button 
                  onClick={() => {}}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <Save size={20} />
                  Save Draft
                </button>
                <button 
                  onClick={finalizeConfig}
                  className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest shadow-lg shadow-indigo-900/40"
                >
                  <Download size={20} />
                  Download & Init
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Top Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-sm flex items-center justify-center">
            <Layers className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white uppercase">
              TECHNODINAMICA <span className="text-indigo-400">EPS-V2</span>
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-sans">Industrial Cutting Line Management</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-8">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Global Speed Sync</p>
            <p className="text-lg font-mono text-emerald-400">
              {machineState === 'RUNNING' ? 'ACTIVE' : 'STANDBY'} ({(params.masterSpeed * 2.4).toFixed(1)} m/min)
            </p>
          </div>
          
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">System Power</p>
            <p className="text-lg font-mono text-slate-200">{(42.5 + Math.random() * 5).toFixed(1)} kW</p>
          </div>

          <div className="flex items-center gap-3 pl-4 border-l border-slate-700">
            <button 
              onClick={() => setViewMode(prev => prev === '2D' ? '3D' : '2D')}
              className="px-3 py-1 bg-slate-800 text-[10px] font-bold text-slate-400 border border-slate-700 rounded uppercase tracking-widest hover:text-white transition-all flex items-center gap-2"
            >
              <div className={cn("w-2 h-2 rounded-full", viewMode === '3D' ? "bg-indigo-500" : "bg-slate-600")} />
              {viewMode}
            </button>
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold font-sans">Status</span>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "px-2 py-0.5 text-[10px] font-bold rounded border uppercase tracking-tighter",
                  machineState === 'RUNNING' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : 
                  machineState === 'EMERGENCY_STOP' ? "bg-red-500/10 text-red-500 border-red-500/20" : 
                  "bg-amber-500/10 text-amber-500 border-amber-500/20"
                )}>
                  {machineState.replace('_', ' ')}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 ml-2">
              <button 
                onClick={toggleMachine}
                className={cn(
                  "p-2.5 rounded transition-all active:scale-95 border",
                  machineState === 'RUNNING' ? "bg-indigo-600/10 text-indigo-400 border-indigo-600/30 hover:bg-indigo-600/20" : "bg-emerald-600/10 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/20"
                )}
              >
                {machineState === 'RUNNING' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button 
                onClick={resetMachine}
                className="p-2.5 bg-slate-800 text-slate-400 border border-slate-700 rounded transition-all hover:bg-slate-700 active:scale-95"
              >
                <RefreshCcw size={18} />
              </button>
              <button 
                onClick={emergencyStop}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
              >
                <Square size={18} fill="currentColor" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1">
        
        {/* Main Machine Visualization */}
        <section className="xl:col-span-9 flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 flex flex-col gap-8 flex-1 relative overflow-hidden h-[500px] rounded-lg">
             {/* Factory Grid Background */}
             <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
             
             <div className="flex flex-1 gap-4 relative z-10">
                {/* Zone 1: Loading & Prep */}
                <MachineZone 
                   id="Zone 01" 
                   title="Intake & Prep" 
                   description={zoneStatuses.Z1 === 'POSITIONING' ? `Positioning Wires: ${wirePositioning?.zone === 'Z1' ? wirePositioning.wireIndex : 0}/${params.z1Wires}` : "Loading, Measuring, Hydraulic Lowering, Horizontal Slicing"}
                   icon={<Maximize2 className="text-indigo-400" size={16} />}
                   status={zoneStatuses.Z1}
                   wireSetting={wirePositioning?.zone === 'Z1' ? wirePositioning.wireIndex : undefined}
                   totalWires={params.z1Wires}
                   onClearError={() => setZoneStatuses(prev => ({ ...prev, Z1: 'READY' }))}
                   viewMode={viewMode}
                >
                   <Conveyor blocks={blocks.filter(b => b.step.startsWith('Z1_'))} zone="Z1" />
                </MachineZone>

                {/* Zone 2: Vertical Cutting */}
                <MachineZone 
                   id="Zone 02" 
                   title="Vertical Section" 
                   description={zoneStatuses.Z2 === 'POSITIONING' ? `Positioning Wires: ${wirePositioning?.zone === 'Z2' ? wirePositioning.wireIndex : 0}/${params.z2Wires}` : "Multi-wire vertical frame cutting system"}
                   icon={<Layers className="text-indigo-400" size={16} />}
                   highlight
                   status={zoneStatuses.Z2}
                   wireSetting={wirePositioning?.zone === 'Z2' ? wirePositioning.wireIndex : undefined}
                   totalWires={params.z2Wires}
                   onClearError={() => setZoneStatuses(prev => ({ ...prev, Z2: 'READY' }))}
                   viewMode={viewMode}
                >
                   <Conveyor blocks={blocks.filter(b => b.step.startsWith('Z2_'))} zone="Z2" />
                </MachineZone>

                {/* Zone 3: Slicing & Dispatch */}
                <MachineZone 
                   id="Zone 03" 
                   title="Cross Slice" 
                   description="Final sizing and high speed discharge"
                   icon={<RefreshCcw className="text-indigo-400" size={16} />}
                   status={zoneStatuses.Z3}
                   onClearError={() => setZoneStatuses(prev => ({ ...prev, Z3: 'READY' }))}
                   viewMode={viewMode}
                >
                   <Conveyor blocks={blocks.filter(b => b.step.startsWith('Z3_'))} zone="Z3" />
                </MachineZone>
             </div>

             {/* Floor Layout Markers */}
             <div className="absolute bottom-6 left-6 right-6 flex justify-between px-12 pointer-events-none opacity-50">
                <div className="flex flex-col gap-1 items-center">
                   <div className="w-0.5 h-6 bg-slate-700" />
                   <span className="text-[10px] font-mono text-slate-500 tracking-widest">0.0M</span>
                </div>
                <div className="flex flex-col gap-1 items-center">
                   <div className="w-0.5 h-6 bg-slate-700" />
                   <span className="text-[10px] font-mono text-slate-500 tracking-widest">6.5M</span>
                </div>
                <div className="flex flex-col gap-1 items-center">
                   <div className="w-0.5 h-6 bg-slate-700" />
                   <span className="text-[10px] font-mono text-slate-500 tracking-widest">12.0M</span>
                </div>
                <div className="flex flex-col gap-1 items-center">
                   <div className="w-0.5 h-6 bg-slate-700" />
                   <span className="text-[10px] font-mono text-slate-500 tracking-widest">18.5M</span>
                </div>
             </div>
          </div>

          {/* Activity Log / Status Feed */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <StatusCard 
                label="Process Throughput" 
                value={`${completedCount}`} 
                unit="Units" 
                icon={<Activity size={16} className="text-indigo-400" />} 
                subValue={`+${(completedCount * 1.2).toFixed(1)} m³ Total Volume`}
             />
             <StatusCard 
                label="System Efficiency" 
                value={`${efficiency.toFixed(1)}`} 
                unit="%" 
                icon={<Gauge size={16} className="text-emerald-400" />} 
                subValue={params.optimizerActive ? "Geometric Optimizer Active" : "Standard Cycle"}
             />
             <StatusCard 
                label="Global Velocity" 
                value={`${(params.masterSpeed * 2.4).toFixed(1)}`} 
                unit="m/min" 
                icon={<Zap size={16} className="text-indigo-400" />} 
                subValue={`Synchronized Flow`}
             />
          </div>

          {/* Scrap Collection System Visualization */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-lg overflow-hidden relative">
             <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-indigo-600/10 rounded border border-indigo-600/20">
                      <Trash2 size={16} className="text-indigo-400" />
                   </div>
                   <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-widest">Scrap Recovery System</h3>
                      <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Under-line collection • Primary extraction</p>
                   </div>
                </div>
                <div className="flex items-center gap-6">
                   <div className="text-right">
                      <p className="text-[9px] text-slate-500 uppercase font-mono">Recovery Rate</p>
                      <p className="text-sm font-mono text-emerald-400">{(scrapState.totalRecycled * 0.01).toFixed(2)} m³/min</p>
                   </div>
                   <div className="text-right">
                      <p className="text-[9px] text-slate-500 uppercase font-mono">Total Recycled</p>
                      <p className="text-sm font-mono text-white">{(scrapState.totalRecycled * 0.1).toFixed(1)} kg</p>
                   </div>
                </div>
             </div>

             <div className="relative h-24 flex items-center">
                {/* Secondary Collection Belt */}
                <div className="absolute inset-x-0 h-4 bg-slate-950 border-y border-slate-800 transform skew-x-12 opacity-50" />
                
                {/* Scrap particles moving toward Zone 3 outlet */}
                <div className="flex-1 flex justify-around items-center px-12 overflow-hidden">
                   {[...Array(12)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ 
                          x: machineState === 'RUNNING' ? [0, 1000] : 0,
                          opacity: machineState === 'RUNNING' ? [0, 1, 1, 0] : 0.1
                        }}
                        transition={{ 
                          duration: 4 / (params.masterSpeed / 5), 
                          repeat: Infinity, 
                          delay: i * 0.4,
                          ease: "linear"
                        }}
                        className="w-2 h-2 bg-slate-200/20 rounded-sm rotate-45 shrink-0"
                      />
                   ))}
                </div>

                {/* Outlet: Crusher & Fan at end of Z3 */}
                <div className="absolute right-0 top-0 bottom-0 flex items-center gap-4 bg-slate-900 pl-4 border-l border-slate-800">
                   {/* Crusher Unit */}
                   <div className="flex flex-col items-center gap-2">
                      <div className={cn(
                        "w-12 h-12 bg-slate-950 border rounded flex items-center justify-center relative overflow-hidden",
                        scrapState.crusherActive ? "border-indigo-500/50" : "border-slate-800"
                      )}>
                         <RefreshCcw 
                           size={20} 
                           className={cn(
                             "text-slate-600 transition-all",
                             scrapState.crusherActive && "text-indigo-400"
                           )} 
                           style={{ transform: scrapState.crusherActive ? `rotate(${Date.now() % 360}deg)` : 'none' }}
                         />
                         {scrapState.crusherActive && (
                            <motion.div 
                              animate={{ scale: [1, 1.2, 1] }}
                              transition={{ duration: 0.2, repeat: Infinity }}
                              className="absolute inset-0 bg-indigo-500/5"
                            />
                         )}
                      </div>
                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">CRUSHER_v3</span>
                   </div>

                   {/* High Rise Fan */}
                   <div className="flex flex-col items-center gap-2">
                      <div className={cn(
                        "w-12 h-12 bg-slate-950 border rounded flex items-center justify-center relative",
                        scrapState.fanSpeed > 0 ? "border-emerald-500/50" : "border-slate-800"
                      )}>
                         <Fan 
                           size={24} 
                           className={cn(
                             "text-slate-600",
                             scrapState.fanSpeed > 0 && "text-emerald-400 animate-spin"
                           )}
                           style={{ animationDuration: scrapState.fanSpeed > 0 ? `${100 / (scrapState.fanSpeed / 10)}ms` : '3s' }}
                         />
                         {scrapState.fanSpeed > 0 && (
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                         )}
                      </div>
                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">EXTRACTION_FAN</span>
                   </div>

                   {/* Pipe to Silos */}
                   <div className="flex flex-col gap-1 pr-4">
                      <div className={cn(
                        "w-16 h-2 bg-slate-950 border border-slate-800 rounded-full relative overflow-hidden",
                        scrapState.fanSpeed > 0 && "border-indigo-500/30"
                      )}>
                         <motion.div 
                            animate={{ x: [0, 60] }}
                            transition={{ duration: 0.5, repeat: Infinity, ease: "linear" }}
                            className="absolute inset-y-0 w-4 bg-indigo-500/20 blur-sm"
                         />
                      </div>
                      <div className="flex justify-between items-center px-1">
                         <span className="text-[8px] text-slate-600 font-mono">SILO_LINK</span>
                         <Wind size={8} className={cn(scrapState.fanSpeed > 0 ? "text-indigo-400" : "text-slate-800")} />
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </section>

        {/* Control Desk */}
        <aside className="xl:col-span-3 flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 flex flex-col gap-8 rounded-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
               <h2 className="text-xs font-bold text-slate-400 flex items-center gap-2 uppercase tracking-[0.2em]">
                  <Settings size={14} className="text-indigo-500" />
                  Control Module
               </h2>
               <div className="lcd-display px-2 py-0.5 rounded text-[9px] tracking-widest uppercase border-slate-700">
                  TD-v2.A
               </div>
            </div>

            {/* Master Synchronization */}
            <div className="space-y-4">
               <div className="flex justify-between items-end">
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Master Speed Sync</label>
                  <span className="text-lg font-mono font-bold text-indigo-400">{params.masterSpeed} G</span>
               </div>
               <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  step="0.1"
                  value={params.masterSpeed}
                  onChange={(e) => updateMasterSpeed(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
               />
               <p className="text-[10px] text-slate-500 leading-relaxed font-sans">
                  Synchronizes multi-zone velocity frames to maintain operational laminar cutting balance.
               </p>
            </div>

            {/* Special Feature: Optimizer */}
            <div className="pt-6 border-t border-slate-800 space-y-4">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <Zap size={16} className={cn(params.optimizerActive ? "text-indigo-400" : "text-slate-600")} />
                     <span className="text-[11px] font-bold text-slate-300 tracking-widest uppercase italic">Geometric AI</span>
                  </div>
                  <button 
                    onClick={() => setParams(p => ({ ...p, optimizerActive: !p.optimizerActive }))}
                    className={cn(
                       "relative w-10 h-5 rounded-full transition-colors",
                       params.optimizerActive ? "bg-indigo-600" : "bg-slate-700"
                    )}
                  >
                     <motion.div 
                        animate={{ x: params.optimizerActive ? 22 : 2 }}
                        className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm" 
                     />
                  </button>
               </div>
               
               <div className={cn(
                  "p-4 rounded border transition-all flex flex-col gap-3",
                  params.optimizerActive ? "bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-900/20" : "bg-slate-950 border-slate-800 text-slate-400"
               )}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-widest">Special Feature Optimizer</p>
                    <div className="flex gap-0.5 items-end h-4">
                      <div className={cn("w-1 h-2", params.optimizerActive ? "bg-indigo-300" : "bg-slate-800")}></div>
                      <div className={cn("w-1 h-3", params.optimizerActive ? "bg-indigo-200" : "bg-slate-800")}></div>
                      <div className={cn("w-1 h-4", params.optimizerActive ? "bg-white" : "bg-slate-800")}></div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase opacity-70">Waste Reduction</p>
                    <p className="text-xl font-mono">-{params.optimizerActive ? '18.4' : '0.2'}%</p>
                  </div>
               </div>
            </div>

            <div className="space-y-3 mt-2">
               <h3 className="text-[10px] font-mono text-slate-600 uppercase tracking-widest border-b border-slate-800 pb-2">Active Telemetry</h3>
               <SensorIndicator label="Z1_FLOW_INTAKE" active={machineState === 'RUNNING'} />
               <SensorIndicator label="Z2_WIRE_TEN_H" active={machineState === 'RUNNING'} />
               <SensorIndicator label="Z3_SYNC_DIS" active={blocks.some(b => b.step === 'Z3_DISCHARGING')} />
            </div>

            {logs.length > 0 && (
               <div className="mt-4 space-y-2 max-h-40 overflow-hidden">
                  <h3 className="text-[10px] font-mono text-slate-600 uppercase tracking-widest border-b border-slate-800 pb-2">System Logs</h3>
                  <div className="flex flex-col gap-1.5 overflow-y-auto max-h-32 pr-1">
                     {logs.map(log => (
                        <div key={log.id} className={cn(
                           "text-[9px] font-mono px-2 py-1 rounded border",
                           log.type === 'error' ? "bg-red-500/10 text-red-500 border-red-500/20" : "bg-slate-800/50 text-slate-400 border-slate-700/50"
                        )}>
                           <span className="opacity-50">[{new Date().toLocaleTimeString()}]</span> {log.message}
                        </div>
                     ))}
                  </div>
               </div>
            )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-lg">
             <div className="flex items-start gap-4">
                <AlertCircle className="text-indigo-400 mt-0.5 shrink-0" size={16} />
                <div className="space-y-1">
                   <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Calibration Tip</h4>
                   <p className="text-[10px] text-slate-500 leading-relaxed italic">
                      "Geometric balance is best maintained when Zone 02 heat index remains below 45°C."
                   </p>
                </div>
             </div>
          </div>
        </aside>
      </main>

      {/* Footer Info Status Rail */}
      <footer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-auto">
        <div className="bg-slate-900 px-4 py-3 rounded-md flex items-center gap-3 border border-slate-800">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
          <span className="text-[10px] font-mono text-slate-400 uppercase">PLC SYNC: STABLE</span>
        </div>
        <div className="bg-slate-900 px-4 py-3 rounded-md flex items-center gap-3 border border-slate-800">
          <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]"></div>
          <span className="text-[10px] font-mono text-slate-400 uppercase">HYDRAULICS: 180 BAR</span>
        </div>
        <div className="bg-slate-900 px-4 py-3 rounded-md flex items-center gap-3 border border-slate-800">
          <div className="w-2 h-2 rounded-full bg-slate-600"></div>
          <span className="text-[10px] font-mono text-slate-400 uppercase">OPTIMIZER: v2.0.4-LITE</span>
        </div>
        <button 
          onClick={emergencyStop}
          className="bg-indigo-600 hover:bg-indigo-500 transition-colors py-3 rounded-md text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-indigo-900/20 active:scale-95"
        >
          FORCE EMERGENCY EXIT (F5)
        </button>
      </footer>
    </div>
  );
}

function MachineZone({ 
  id, 
  title, 
  description, 
  icon, 
  children, 
  highlight, 
  status = 'READY', 
  wireSetting, 
  totalWires,
  onClearError,
  viewMode
}: { 
  id: string, 
  title: string, 
  description: string, 
  icon: React.ReactNode, 
  children: React.ReactNode, 
  highlight?: boolean, 
  status?: ZoneStatus,
  wireSetting?: number,
  totalWires?: number,
  onClearError?: () => void,
  viewMode: '2D' | '3D'
}) {
  return (
    <div className="flex-1 flex flex-col gap-4 group relative">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
           <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">{id} <span className="opacity-40">/</span> {title}</h3>
           <span className={cn(
             "text-[8px] px-1 rounded uppercase tracking-tighter border",
             status === 'IDLE' ? "bg-slate-800 text-slate-500 border-slate-700" :
             status === 'POSITIONING' ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 animate-pulse" :
             status === 'ERROR' ? "bg-red-500/10 text-red-500 border-red-500/30 animate-pulse" :
             "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
           )}>
             {status}
           </span>
        </div>
        {icon}
      </div>
      <div className={cn(
        "relative flex-1 min-h-[300px] overflow-hidden flex flex-col rounded-lg border transition-all duration-700",
        highlight 
          ? "bg-indigo-600/5 border-indigo-500/30" 
          : "bg-slate-950/40 border-slate-800",
        viewMode === '3D' && "perspective-[1000px] [transform-style:preserve-3d]"
      )}>
          <div className={cn(
            "flex-1 relative transition-transform duration-700 h-full",
            viewMode === '3D' && "[transform:rotateX(20deg)_rotateY(-10deg)] scale-110"
          )}>
            <AnimatePresence>
              {status === 'IDLE' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center"
                >
                   <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest bg-slate-900 px-3 py-1 rounded-full border border-slate-800">Standby Mode</p>
                </motion.div>
              )}
              {status === 'ERROR' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 bg-red-950/40 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2"
                >
                   <AlertCircle className="text-red-500 animate-bounce" size={24} />
                   <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest bg-slate-950 px-3 py-1 rounded border border-red-500/50 shadow-lg shadow-red-900/40">Zone Critical Failure</p>
                   <button 
                     onClick={(e) => {
                       e.stopPropagation();
                       onClearError?.();
                     }}
                     className="mt-2 text-[8px] bg-red-600 text-white px-2 py-1 rounded uppercase font-bold hover:bg-red-500 transition-colors"
                   >
                     Clear Error
                   </button>
                </motion.div>
              )}
            </AnimatePresence>

            {status === 'POSITIONING' && wireSetting !== undefined && totalWires !== undefined && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950/40">
                {/* Specific hardware for Zone 1: Metal Frames */}
                {id.includes('01') && (
                  <>
                    {/* Lateral Support Frames (3.5m Standing) */}
                    <div className="absolute left-[30%] top-6 bottom-6 w-3 bg-slate-700 border-x border-slate-600 shadow-xl z-0" title="Lateral Support Far" />
                    <div className="absolute right-[30%] top-6 bottom-6 w-3 bg-slate-700 border-x border-slate-600 shadow-xl z-0" title="Lateral Support Near" />
                    
                    {/* Cross Bracing symbolic */}
                    <div className="absolute left-[30%] right-[30%] top-6 h-1 bg-slate-800/40" />
                    <div className="absolute left-[30%] right-[30%] bottom-6 h-1 bg-slate-800/40" />
                  </>
                )}
                
                <div className={cn(
                  "flex gap-1 h-32 items-end relative px-8",
                  id.includes('01') && "flex-col items-center justify-start h-full w-full py-12 gap-1"
                )}>
                   {[...Array(totalWires)].map((_, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, scaleX: 0 }}
                        animate={{ 
                          height: id.includes('01') ? 2 : (i < wireSetting ? '100%' : '10%'),
                          width: id.includes('01') ? (i < wireSetting ? '40%' : '0%') : 4,
                          opacity: i < wireSetting ? 1 : 0,
                          backgroundColor: i === wireSetting - 1 ? '#6366f1' : '#64748b',
                          scaleX: i < wireSetting ? 1 : 0
                        }}
                        className="rounded-full shrink-0"
                      />
                   ))}
                </div>
                <div className="text-center z-10 bg-slate-900/80 px-2 py-1 rounded backdrop-blur-sm">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                    {id.includes('01') ? "Horizontal Wire Array (Top-Down)" : "Hydraulic Wire Frame"}
                  </p>
                  <p className="text-[9px] font-mono text-slate-500 uppercase">Unit {wireSetting + 1}/{totalWires}</p>
                </div>
              </div>
            )}

            {children}
            
            {/* Visual geometry decorations from theme */}
            {highlight && (
              <div className="absolute top-0 right-0 p-2 opacity-[0.05] pointer-events-none">
                <div className="w-48 h-48 border-[12px] border-indigo-500 rounded-full -mr-24 -mt-24"></div>
              </div>
            )}
          </div>

          <div className={cn(
            "p-3 border-t text-[9px] uppercase tracking-widest font-bold",
            highlight ? "border-indigo-500/20 text-indigo-400" : "border-slate-800 text-slate-500"
          )}>
            {description}
          </div>
      </div>
    </div>
  );
}

function Conveyor({ blocks, zone }: { blocks: Block[], zone: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
       {/* Conveyor Belt Visual */}
       <div className="absolute w-full h-12 bg-white/5 border-y border-white/10 transform -skew-x-12" />
       
       <AnimatePresence>
          {blocks.map((block) => (
             <motion.div
                key={block.id}
                initial={{ x: -100, opacity: 0, scale: 0.8 }}
                animate={{ 
                  x: block.progress > 0 ? (block.progress * 2) - 100 : -100, 
                  opacity: 1, 
                  scale: 1 
                }}
                exit={{ x: 300, opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', damping: 20, stiffness: 60 }}
                className="absolute"
             >
                <EPSBlock step={block.step} progress={block.progress} />
             </motion.div>
          ))}
       </AnimatePresence>
    </div>
  );
}

function EPSBlock({ step, progress }: { step: BlockProcessStep, progress: number }) {
  const getLabel = () => {
    switch(step) {
      case 'Z1_LOADING': return 'Intake';
      case 'Z1_POSITIONING': return 'Pos_X';
      case 'Z1_MEASURING': return 'Optics';
      case 'Z1_HYDRAULIC_FALL': return 'Desc';
      case 'Z1_HORIZ_CUT': return 'Slice_H';
      case 'Z2_TRANSIT': return 'Transit';
      case 'Z2_VERT_CUT': return 'Cut_V';
      case 'Z3_TRANSIT': return 'Transit';
      case 'Z3_SLICING': return 'Cross';
      case 'Z3_DISCHARGING': return 'Disch';
      default: return '';
    }
  };

  return (
    <div className="relative group cursor-pointer">
       {/* Block Body */}
       <div className="w-24 h-16 bg-slate-100 border border-slate-300 relative flex items-center justify-center overflow-hidden shadow-sm rounded-sm">
          {/* Internal Wire Visuals if cutting using primary indigo from theme */}
          {(step === 'Z1_HORIZ_CUT') && (
             <motion.div 
               animate={{ y: [0, 64] }}
               transition={{ duration: 1, repeat: Infinity }}
               className="absolute top-0 left-0 right-0 h-1 bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] z-20"
             />
          )}

          {(step === 'Z2_VERT_CUT') && (
             <div className="absolute inset-0 flex justify-evenly pointer-events-none py-1">
                {[1, 2, 3].map(i => (
                  <motion.div 
                    key={i}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                    className="w-1 bg-indigo-400 h-full shadow-[0_0_8px_rgba(129,140,248,0.3)]"
                  />
                ))}
             </div>
          )}

          <div className="flex flex-col items-center gap-1.5 z-10">
             <span className="text-[8px] font-bold text-slate-800 leading-none tracking-widest uppercase italic">{getLabel()}</span>
             <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden border border-slate-300/50">
                <motion.div 
                   initial={{ width: 0 }}
                   animate={{ width: `${progress}%` }}
                   className="h-full bg-indigo-600"
                />
             </div>
          </div>
       </div>

       {/* Geometric Tooltip */}
       <div className="absolute -top-14 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all transform group-hover:-translate-y-1 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 p-3 rounded text-[9px] font-mono text-slate-300 whitespace-nowrap shadow-2xl">
             <div className="flex justify-between gap-4 border-b border-slate-800 pb-1 mb-1">
               <span>REF: EPS_BLK_95</span>
               <span className="text-indigo-400">STATUS: OK</span>
             </div>
             <p>VOLUME: 4.80 m³</p>
             <p>CALIB_OFFSET: +0.02mm</p>
          </div>
       </div>
    </div>
  );
}

function StatusCard({ label, value, unit, icon, subValue }: { label: string, value: string, unit: string, icon: React.ReactNode, subValue?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-4 space-y-3 rounded-lg hover:border-slate-700 transition-colors">
       <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{label}</span>
          {icon}
       </div>
       <div className="flex items-baseline gap-2">
          <span className="text-3xl font-mono font-bold text-slate-100 tracking-tighter">{value}</span>
          <span className="text-xs text-slate-500 uppercase font-mono">{unit}</span>
       </div>
       {subValue && (
          <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
             <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
             <span className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">{subValue}</span>
          </div>
       )}
    </div>
  );
}

function SensorIndicator({ label, active }: { label: string, active: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
       <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{label}</span>
       <div className={cn(
          "w-1.5 h-1.5 rounded-full transition-all duration-500",
          active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] scale-110" : "bg-slate-800"
       )} />
    </div>
  );
}
