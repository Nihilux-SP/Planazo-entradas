package com.planazo.entradas.model;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record EventRequest(
    @NotBlank @Size(max = 30) String type,
    @NotBlank @Size(max = 180) String title,
    @NotBlank @Size(max = 180) String venue,
    @NotBlank @Size(max = 80) String city,
    @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}") String date,
    @NotBlank @Pattern(regexp = "\\d{2}:\\d{2}") String time,
    @Min(0) int price,
    @NotBlank @Size(max = 30) String image,
    @NotBlank @Size(max = 20) String accent,
    boolean featured
) {
}
