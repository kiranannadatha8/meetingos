from fastapi import FastAPI
from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: str
    status: str


app = FastAPI(title="MeetingOS Orchestrator", version="0.0.0")


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(service="orchestrator", status="ok")
