import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { TerrainLayout } from '@warhammer-simulator/core/types/battle';
import { BOARD_FORMATS } from '@warhammer-simulator/core/data/boardFormats';
import { EDITIONS } from '@warhammer-simulator/core/engine/rulesEngine';
import {
  ELEVENTH_EDITION_FORCE_DISPOSITIONS,
  PRIMARY_MISSIONS,
  eleventhPrimaryMissionsForDispositions,
  type EleventhForceDispositionId,
} from '@warhammer-simulator/core/engine/missions';

type Props = {
  armyBuilderMode?: boolean;
  battleStarted: boolean;
  editionId: string;
  isEleventhEdition: boolean;
  primaryMission: string;
  forceDisposition0: EleventhForceDispositionId;
  forceDisposition1: EleventhForceDispositionId;
  deployment: string;
  availableDeployments: string[];
  boardFormatId: string;
  layoutId: string;
  compatibleLayouts: TerrainLayout[];
  onOpenModeChooser: () => void;
  onEditionChange: (value: string) => void;
  onPrimaryMissionChange: (value: string) => void;
  onForceDisposition0Change: (value: EleventhForceDispositionId) => void;
  onForceDisposition1Change: (value: EleventhForceDispositionId) => void;
  onDeploymentChange: (value: string) => void;
  onBoardFormatChange: (value: string) => void;
  onLayoutChange: (value: string) => void;
  onRandomizeMissionSet: () => void;
};

export function AppHeader({
  armyBuilderMode = false,
  battleStarted,
  editionId,
  isEleventhEdition,
  primaryMission,
  forceDisposition0,
  forceDisposition1,
  deployment,
  availableDeployments,
  boardFormatId,
  layoutId,
  compatibleLayouts,
  onOpenModeChooser,
  onEditionChange,
  onPrimaryMissionChange,
  onForceDisposition0Change,
  onForceDisposition1Change,
  onDeploymentChange,
  onBoardFormatChange,
  onLayoutChange,
  onRandomizeMissionSet,
}: Props) {
  return (
    <header className="header">
      <Typography className="title" component="h1" variant="subtitle1">
        Warhammer Battle Simulator
      </Typography>

      <Button size="small" color="secondary" variant="outlined" onClick={onOpenModeChooser}>
        Change Mode
      </Button>

      {!battleStarted && !armyBuilderMode && (
        <Box className="header-controls">
          <FormControl sx={{ minWidth: 132 }}>
            <InputLabel id="edition-label">Edition</InputLabel>
            <Select
              labelId="edition-label"
              value={editionId}
              label="Edition"
              disabled={battleStarted}
              onChange={(event: SelectChangeEvent) => onEditionChange(event.target.value)}
            >
              {EDITIONS.map(edition => (
                <MenuItem key={edition.id} value={edition.id} title={edition.description}>
                  {edition.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {!isEleventhEdition ? (
            <FormControl sx={{ minWidth: 190 }}>
              <InputLabel id="mission-label">Mission</InputLabel>
              <Select
                labelId="mission-label"
                value={primaryMission}
                label="Mission"
                disabled={battleStarted}
                onChange={(event: SelectChangeEvent) => onPrimaryMissionChange(event.target.value)}
              >
                {PRIMARY_MISSIONS.map(name => (
                  <MenuItem key={name} value={name}>{name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <>
              <FormControl sx={{ minWidth: 190 }}>
                <InputLabel id="force-disposition-0-label">Blue Disposition</InputLabel>
                <Select
                  labelId="force-disposition-0-label"
                  value={forceDisposition0}
                  label="Blue Disposition"
                  disabled={battleStarted}
                  onChange={(event: SelectChangeEvent) => onForceDisposition0Change(event.target.value as EleventhForceDispositionId)}
                >
                  {ELEVENTH_EDITION_FORCE_DISPOSITIONS.map(disposition => (
                    <MenuItem key={disposition.id} value={disposition.id}>
                      {disposition.name} - {eleventhPrimaryMissionsForDispositions([disposition.id, forceDisposition1])[0]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl sx={{ minWidth: 190 }}>
                <InputLabel id="force-disposition-1-label">Red Disposition</InputLabel>
                <Select
                  labelId="force-disposition-1-label"
                  value={forceDisposition1}
                  label="Red Disposition"
                  disabled={battleStarted}
                  onChange={(event: SelectChangeEvent) => onForceDisposition1Change(event.target.value as EleventhForceDispositionId)}
                >
                  {ELEVENTH_EDITION_FORCE_DISPOSITIONS.map(disposition => (
                    <MenuItem key={disposition.id} value={disposition.id}>
                      {disposition.name} - {eleventhPrimaryMissionsForDispositions([forceDisposition0, disposition.id])[1]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}

          {!isEleventhEdition && (
            <FormControl sx={{ minWidth: 190 }}>
              <InputLabel id="deployment-label">Deployment</InputLabel>
              <Select
                labelId="deployment-label"
                value={deployment}
                label="Deployment"
                disabled={battleStarted}
                onChange={(event: SelectChangeEvent) => onDeploymentChange(event.target.value)}
              >
                {availableDeployments.map(name => (
                  <MenuItem key={name} value={name}>{name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl sx={{ minWidth: 148 }}>
            <InputLabel id="format-label">Format</InputLabel>
            <Select
              labelId="format-label"
              value={boardFormatId}
              label="Format"
              disabled={battleStarted}
              onChange={(event: SelectChangeEvent) => onBoardFormatChange(event.target.value)}
            >
              {BOARD_FORMATS.map(format => (
                <MenuItem key={format.id} value={format.id}>{format.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 132 }}>
            <InputLabel id="terrain-label">Terrain</InputLabel>
            <Select
              labelId="terrain-label"
              value={layoutId}
              label="Terrain"
              disabled={battleStarted}
              onChange={(event: SelectChangeEvent) => onLayoutChange(event.target.value)}
            >
              {compatibleLayouts.map(layout => (
                <MenuItem key={layout.id} value={layout.id} title={layout.description}>
                  {layout.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            color="secondary"
            startIcon={<CasinoOutlinedIcon />}
            onClick={onRandomizeMissionSet}
            disabled={battleStarted}
          >
            Random Set
          </Button>
        </Box>
      )}
    </header>
  );
}
