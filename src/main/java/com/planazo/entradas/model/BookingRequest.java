package com.planazo.entradas.model;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record BookingRequest(long eventId, @Min(1) @Max(10) int quantity) {
}
