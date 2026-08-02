const MachineStatus = {
  AVAILABLE: 'AVAILABLE',
  IN_USE: 'IN_USE',
  COMPLETING: 'COMPLETING',
  ERROR: 'ERROR',
  MAINTENANCE: 'MAINTENANCE'
};

const MachineType = {
  WASHER: 'WASHER',
  DRYER: 'DRYER'
};

module.exports = { MachineStatus, MachineType };
