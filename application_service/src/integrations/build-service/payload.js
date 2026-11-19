export function buildPayload(application, requestId) {
  return {
    request_id: requestId,
    application_id: application.id,
    owner_id: application.owner_id,
    name: application.name,
    repository_url: application.repository_url,
    branch: application.branch,
    application_type: application.application_type,
    source_directory: application.source_directory,
    requirements_file: application.requirements_file,
    port: application.port,
    run_command: application.run_command,
  };
}
