SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.PreventivePlans','U') IS NULL
  THROW 50502, 'Ejecuta primero las migraciones preventivas 015 y 016.', 1;
 IF OBJECT_ID('dbo.MachineHourReadings','U') IS NULL
 BEGIN
  CREATE TABLE dbo.MachineHourReadings(
   ReadingId BIGINT IDENTITY PRIMARY KEY, MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId),
   Hours DECIMAL(12,2) NOT NULL CHECK(Hours>=0), CounterHours DECIMAL(12,2) NOT NULL CHECK(CounterHours>=0),
   CounterReset BIT NOT NULL DEFAULT 0, ObservedAt DATETIME2 NOT NULL,
   RecordedBy INT NOT NULL REFERENCES dbo.Usuarios(Id)
  );
  CREATE INDEX IX_MachineHourReadings_Latest ON dbo.MachineHourReadings(MachineId,ObservedAt DESC,ReadingId DESC);
  CREATE UNIQUE INDEX UQ_MachineHourReadings_Instant ON dbo.MachineHourReadings(MachineId,ObservedAt);
 END;
 IF OBJECT_ID('dbo.PreventiveHourOccurrences','U') IS NULL
 BEGIN
  CREATE TABLE dbo.PreventiveHourOccurrences(
   OccurrenceId BIGINT IDENTITY PRIMARY KEY, PlanId INT NOT NULL REFERENCES dbo.PreventivePlans(PlanId),
   MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId),
   TargetHours DECIMAL(12,2) NOT NULL, CompletedHours DECIMAL(12,2) NULL,
   RequestId INT NOT NULL REFERENCES dbo.MaintenanceRequests(RequestId) ON DELETE CASCADE,
   CONSTRAINT UQ_PreventiveHourOccurrences_RequestMachine UNIQUE(RequestId,MachineId)
  );
  CREATE INDEX IX_PreventiveHourOccurrences_Plan ON dbo.PreventiveHourOccurrences(PlanId,MachineId);
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
