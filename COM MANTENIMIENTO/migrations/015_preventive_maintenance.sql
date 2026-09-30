-- Módulo preventivo. Compatible con SQL Server 2014; no altera registros existentes.
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.MaintenanceRequests','U') IS NULL
  THROW 50500, 'Ejecuta primero las migraciones de solicitudes.', 1;
 IF OBJECT_ID('dbo.PreventiveActivities','U') IS NULL
 CREATE TABLE dbo.PreventiveActivities (
  ActivityId INT IDENTITY PRIMARY KEY, Data NVARCHAR(MAX) NOT NULL,
  Revision INT NOT NULL DEFAULT 1, UpdatedBy INT NOT NULL REFERENCES dbo.Usuarios(Id), UpdatedAt DATETIME2 NOT NULL
 );
 IF OBJECT_ID('dbo.PreventivePlans','U') IS NULL
 BEGIN
  CREATE TABLE dbo.PreventivePlans (
   PlanId INT IDENTITY PRIMARY KEY, ActivityId INT NOT NULL REFERENCES dbo.PreventiveActivities(ActivityId),
   MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId), ElementId INT NULL REFERENCES dbo.MachineElements(ElementId),
   Data NVARCHAR(MAX) NOT NULL, NextDue DATE NOT NULL, Revision INT NOT NULL DEFAULT 1,
   UpdatedBy INT NOT NULL REFERENCES dbo.Usuarios(Id), UpdatedAt DATETIME2 NOT NULL
  );
  CREATE INDEX IX_PreventivePlans_NextDue ON dbo.PreventivePlans(NextDue);
 END;
 IF OBJECT_ID('dbo.PreventiveOccurrences','U') IS NULL
 CREATE TABLE dbo.PreventiveOccurrences (
  OccurrenceId INT IDENTITY PRIMARY KEY, PlanId INT NOT NULL REFERENCES dbo.PreventivePlans(PlanId),
  DueDate DATE NOT NULL, RequestId INT NOT NULL REFERENCES dbo.MaintenanceRequests(RequestId),
  CONSTRAINT UQ_PreventiveOccurrences_Cycle UNIQUE(PlanId,DueDate)
 );
 IF OBJECT_ID('dbo.PreventiveSchedule','U') IS NULL
 BEGIN
  CREATE TABLE dbo.PreventiveSchedule (
   ScheduleId INT IDENTITY PRIMARY KEY, RequestId INT NOT NULL REFERENCES dbo.MaintenanceRequests(RequestId),
   ScheduledDate DATE NOT NULL, Moved BIT NOT NULL DEFAULT 0, Reason NVARCHAR(1000) NOT NULL DEFAULT '',
   CreatedBy INT NOT NULL REFERENCES dbo.Usuarios(Id), CreatedAt DATETIME2 NOT NULL
  );
  CREATE UNIQUE INDEX UQ_PreventiveSchedule_Current ON dbo.PreventiveSchedule(RequestId) WHERE Moved=0;
  CREATE INDEX IX_PreventiveSchedule_Date ON dbo.PreventiveSchedule(ScheduledDate);
 END;
 IF OBJECT_ID('dbo.PreventiveWeekClosures','U') IS NULL
 CREATE TABLE dbo.PreventiveWeekClosures (
  WeekStart DATE NOT NULL PRIMARY KEY, Snapshot NVARCHAR(MAX) NOT NULL,
  ClosedBy INT NOT NULL REFERENCES dbo.Usuarios(Id), ClosedAt DATETIME2 NOT NULL
 );
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
